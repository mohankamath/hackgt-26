"""Screened service: the orchestration layer between platforms, moderation, AI, and storage.

Inbound flow (runs on a queue worker, never on the platform listener):
    payload -> contact lookup/creation -> moderation (text + images + avatar, concurrent)
    -> media hosting (flagged media is never made public) -> coach tip -> save message
    -> update contact/thread -> alerts -> schedule thread analysis / contact vetting

Normalised payload (built by each platform adapter):
    platform, message_id, user_id, username, channel_id, channel_name, server_id,
    server_name, is_group, text, timestamp, attachments[{url, filename, type,
    storage_path?}], profile_picture_url, profile_picture_storage_path?
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime

from app import policy
from app.ai import client as ai
from app.ai import coach, contact_vetting, digest, thread_analyzer
from app.db import firestore as fs
from app.moderation import pii as pii_mod
from app.moderation import pipeline
from app.moderation import text as text_mod
from app.services import contacts as contact_rules
from app.services.alerts import AlertService
from app.services.settings import SettingsCache
from app.util import contact_id_for, message_doc_id, normalize_timestamp, strip_query, thread_id_for, utcnow
from app.workers.queue import ModerationQueue

log = logging.getLogger("screened.ingest")


class ScreenedService:
    def __init__(self, store: fs.FirestoreDB, *, workers: int = 4, debounce_seconds: float = 30.0) -> None:
        self.store = store
        self.settings = SettingsCache(store)
        self.alerts = AlertService(store)
        self.queue = ModerationQueue(self.process_inbound, workers=workers)
        self.scheduler = thread_analyzer.ThreadScheduler(self.run_thread_analysis, debounce_seconds)
        self._background: set[asyncio.Task] = set()
        self._vetting: set[str] = set()

    # ── Lifecycle ──────────────────────────────────────────────────

    async def start(self) -> None:
        await self.queue.start()

    async def stop(self) -> None:
        await self.queue.stop()
        await self.scheduler.stop()
        for t in list(self._background):
            t.cancel()
        await asyncio.gather(*self._background, return_exceptions=True)

    def _spawn(self, coro) -> asyncio.Task:
        task = asyncio.create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    async def submit(self, payload: dict) -> None:
        """Called by platform listeners. Returns as soon as the payload is queued."""
        await self.queue.enqueue(payload)

    # ── Inbound ────────────────────────────────────────────────────

    async def process_inbound(self, payload: dict) -> dict:
        settings = await self.settings.get()
        sensitivity = settings["sensitivity"]
        now = utcnow()
        platform = payload["platform"]
        contact_id = contact_id_for(platform, payload["user_id"])
        thread_id = thread_id_for(platform, payload["channel_id"])
        doc_id = message_doc_id(platform, payload["message_id"])

        contact = await self.store.get_contact(contact_id)
        is_new = contact is None
        if is_new:
            contact = contact_rules.new_contact(payload, now)
        contact_status = contact.get("status", "pending")

        if contact_status == "blocked":
            # Don't spend AI calls on blocked senders; keep a record for the parent.
            verdict = pipeline.merge_verdicts(text_mod.safe_verdict(), [], None)
            verdict["status"] = "blocked"
            verdict["profile_picture_checked"] = False
        else:
            pfp_url = payload.get("profile_picture_url")
            cached_pfp = contact.get("pfp_moderation") if contact_rules.pfp_cache_valid(contact, pfp_url, now) else None
            verdict = await pipeline.moderate_message(payload, sensitivity, settings["customKeywords"], cached_pfp)

        attachments = await self._host_attachments(payload, verdict)
        profile_picture = await self._host_profile_picture(payload, verdict, contact)

        visible = contact_rules.visible_to_child(contact_status, verdict["status"])
        tip = await coach.tip_for_message(verdict) if verdict["status"] not in ("safe", "blocked") else None

        doc = {
            "message_id": str(payload["message_id"]),
            "platform": platform,
            "direction": "incoming",
            "user_id": str(payload["user_id"]),
            "username": payload.get("username") or "Unknown",
            "contact_id": contact_id,
            "thread_id": thread_id,
            "channel_id": str(payload["channel_id"]),
            "channel_name": payload.get("channel_name") or "Direct Message",
            "server_id": str(payload.get("server_id") or "DM"),
            "server_name": payload.get("server_name") or "Direct Message",
            "is_group": bool(payload.get("is_group")),
            "message": payload.get("text") or "",
            "masked_content": verdict["masked_content"],
            "status": verdict["status"],
            "censored": verdict["status"] == "censored",
            "severity": verdict["severity"],
            "flagged_words": verdict["flagged_words"],
            "moderation": verdict["moderation"],
            "attachments": attachments,
            "profile_picture": profile_picture,
            "profile_picture_flagged": verdict["profile_picture_flagged"],
            "visible_to_child": visible,
            "coach_tip": tip,
            "timestamp": normalize_timestamp(payload.get("timestamp")),
            "processed_at": now,
        }
        await self.store.save_message(fs.MESSAGES, doc_id, doc)

        # Contact bookkeeping
        threads = list(contact.get("threads") or [])
        if thread_id not in threads:
            threads.append(thread_id)
        contact.update(
            {
                "username": doc["username"],
                "message_count": int(contact.get("message_count") or 0) + 1,
                "last_message_at": now,
                "threads": threads[-20:],
                "flagged_count": int(contact.get("flagged_count") or 0) + (1 if doc["status"] in ("censored", "masked") else 0),
            }
        )
        if profile_picture is not None or verdict["profile_picture_flagged"]:
            contact["profile_picture"] = profile_picture
        if verdict.get("profile_picture_checked") and verdict.get("profile_picture"):
            pv = verdict["profile_picture"]
            contact["pfp_moderation"] = {
                "status": pv["status"],
                "categories": pv["categories"],
                "severity": pv["severity"],
                "source": strip_query(payload.get("profile_picture_url")),
                "checked_at": now,
            }
        await self.store.set_contact(contact_id, contact, merge=False)
        await self.store.touch_thread(
            thread_id,
            {
                "platform": platform,
                "channel_id": doc["channel_id"],
                "channel_name": doc["channel_name"],
                "is_group": doc["is_group"],
                "last_message_at": now,
            },
            participant=contact_id,
        )

        await self._raise_inbound_alerts(doc, doc_id, contact, is_new)

        if contact_status != "blocked":
            severity = doc["severity"]
            if verdict.get("grooming_hints"):
                severity = policy.max_severity([severity, "medium"])
            self.scheduler.note_message(thread_id, severity, inbound=True, watch=contact_status == "watch")
            if contact_rules.should_revet(contact):
                self._spawn(self.vet_contact(contact_id))
        log.info("[%s] %s from %s -> %s", platform, doc_id, doc["username"], doc["status"])
        return doc

    async def _host_attachments(self, payload: dict, verdict: dict) -> list[dict]:
        out = []
        for att, v in zip(payload.get("attachments") or [], verdict["attachments"]):
            flagged = v["status"] == "censored"
            data = v.pop("_bytes", None)
            url = att.get("url")
            review_url = att.get("review_url")
            storage_path = att.get("storage_path")
            if storage_path and data is not None:
                try:
                    # Only safe media is made public. Flagged media is stored privately so a
                    # parent can review it through a short-lived signed URL.
                    public_url = await self.store.upload_blob(storage_path, data, att.get("type") or "image/jpeg", public=not flagged and v["status"] == "safe")
                    url = public_url if public_url else (url if not flagged else None)
                except Exception as exc:
                    log.warning("media upload failed for %s: %s", storage_path, exc)
                    if hidden := flagged or v["status"] == "needs_review":
                        review_url = url
            elif storage_path and v["kind"] == "video":
                storage_path = None  # videos are not re-hosted; parent reviews via the source URL
            hidden = v["status"] in ("censored", "needs_review")
            out.append(
                {
                    "url": None if hidden else url,
                    "review_url": review_url or (url if hidden and not storage_path else None),
                    "storage_path": storage_path if hidden else None,
                    "filename": att.get("filename") or "attachment",
                    "type": att.get("type") or "",
                    "kind": v["kind"],
                    "flagged": flagged,
                    "status": v["status"],
                    "categories": v["categories"],
                    "severity": v["severity"],
                    "error": v.get("error"),
                }
            )
        return out

    async def _host_profile_picture(self, payload: dict, verdict: dict, contact: dict) -> str | None:
        if verdict["profile_picture_flagged"]:
            return None  # UI shows a default avatar
        pv = verdict.get("profile_picture")
        url = payload.get("profile_picture_url")
        if not verdict.get("profile_picture_checked"):
            return contact.get("profile_picture") or (url if pv and pv.get("status") == "safe" else None)
        data = pv.pop("_bytes", None) if pv else None
        path = payload.get("profile_picture_storage_path")
        if path and data is not None and pv and pv["status"] == "safe":
            try:
                hosted = await self.store.upload_blob(path, data, "image/jpeg", public=True)
                if hosted:
                    return hosted
            except Exception as exc:
                log.warning("avatar upload failed: %s", exc)
        return url if pv and pv["status"] == "safe" else None

    async def _raise_inbound_alerts(self, doc: dict, doc_id: str, contact: dict, is_new: bool) -> None:
        cid = doc["contact_id"]
        if is_new:
            await self.alerts.raise_alert(
                "new_contact",
                "low",
                f"New contact: {doc['username']}",
                f"{doc['username']} messaged your child on {doc['platform'].title()}. Their messages stay hidden until you approve them.",
                contact_id=cid,
                thread_id=doc["thread_id"],
            )
        if doc["status"] == "censored" and policy.severity_rank(doc["severity"]) >= policy.severity_rank("high"):
            reasons = ", ".join(doc["moderation"]["reasons"][:3])
            await self.alerts.raise_alert(
                "message_flagged",
                "high",
                f"Blocked a harmful message from {doc['username']}",
                f"Reason: {reasons or 'harmful content'}.",
                contact_id=cid,
                thread_id=doc["thread_id"],
                message_doc_id=doc_id,
            )
        if doc["profile_picture_flagged"]:
            await self.alerts.raise_alert(
                "contact_risk",
                "high",
                f"{doc['username']} has an inappropriate profile picture",
                "We replaced it with a default avatar for your child.",
                contact_id=cid,
            )

    # ── Outgoing (child -> contact) ────────────────────────────────

    async def record_outgoing(self, payload: dict) -> dict:
        settings = await self.settings.get()
        now = utcnow()
        platform = payload["platform"]
        thread_id = thread_id_for(platform, payload["channel_id"])
        text = payload.get("text") or ""
        verdict = await text_mod.moderate_text(text, settings["sensitivity"], settings["customKeywords"])
        pii_hits = pii_mod.find_pii(text)
        message_id = str(payload.get("message_id") or f"sent-{uuid.uuid4().hex}")
        doc_id = message_doc_id(platform, message_id)
        doc = {
            "message_id": message_id,
            "platform": platform,
            "direction": "outgoing",
            "user_id": str(payload.get("user_id") or "child"),
            "username": payload.get("username") or settings.get("childName") or "Me",
            "thread_id": thread_id,
            "channel_id": str(payload["channel_id"]),
            "channel_name": payload.get("channel_name") or "Direct Message",
            "server_id": str(payload.get("server_id") or "DM"),
            "message": text,
            "masked_content": None,
            "status": verdict["status"] if verdict["status"] != "masked" else "safe",
            "censored": False,
            "severity": verdict["severity"],
            "flagged_words": verdict["flagged_words"],
            "moderation": {"categories": verdict["categories"], "scores": verdict["scores"], "reasons": verdict["reasons"], "error": verdict["error"]},
            "pii": [{"type": h["type"], "label": h["label"]} for h in pii_hits],
            "attachments": [],
            "profile_picture": settings.get("childAvatar") or None,
            "visible_to_child": True,
            "timestamp": now,
            "processed_at": now,
        }
        await self.store.save_message(fs.SENT_MESSAGES, doc_id, doc)
        await self.store.touch_thread(thread_id, {"platform": platform, "channel_id": doc["channel_id"], "last_message_at": now})

        cats = {c["category"] for c in verdict["categories"]}
        if cats & {"self-harm", "self-harm/intent", "self-harm/instructions"}:
            await self.alerts.raise_alert(
                "child_wellbeing",
                "high",
                f"{settings.get('childName', 'Your child')} may be going through something hard",
                "A message they sent mentioned self-harm. Consider checking in gently. If there is immediate danger, call 911 or the 988 Suicide & Crisis Lifeline.",
                thread_id=thread_id,
                message_doc_id=doc_id,
            )
        elif pii_hits:
            labels = ", ".join(sorted({h["label"] for h in pii_hits}))
            await self.alerts.raise_alert(
                "personal_info_shared",
                "medium",
                f"{settings.get('childName', 'Your child')} shared personal info",
                f"A sent message looked like it contained: {labels}.",
                thread_id=thread_id,
                message_doc_id=doc_id,
            )
        self.scheduler.note_message(thread_id, verdict["severity"], inbound=False)
        return doc

    async def check_can_send(self, platform: str, channel_id: str) -> tuple[bool, str | None]:
        thread = await self.store.get_thread(thread_id_for(platform, channel_id))
        participants = (thread or {}).get("participants") or []
        statuses = []
        for cid in participants:
            c = await self.store.get_contact(cid)
            statuses.append((c or {}).get("status"))
        return contact_rules.can_send(statuses)

    # ── Thread analysis ────────────────────────────────────────────

    async def run_thread_analysis(self, thread_id: str) -> dict:
        messages = await self.store.thread_messages(thread_id, limit=30)
        previous = await self.store.get_thread(thread_id) or {}
        now = utcnow()
        # Blocked senders' messages don't count toward analysis
        messages = [m for m in messages if m.get("status") != "blocked"]
        if not messages:
            return previous
        try:
            result = await thread_analyzer.analyze(messages)
        except ai.AIError as exc:
            log.warning("thread analysis failed for %s: %s", thread_id, exc)
            patch = {"analysis_status": "needs_review", "analysis_error": str(exc)[:300], "updated_at": now}
            await self.store.set_thread(thread_id, patch)
            return {**previous, **patch}

        child_tip = None
        if policy.risk_rank(result["risk_level"]) >= policy.risk_rank("medium"):
            child_tip = await coach.tip_for(coach.situation_for_signals([s["type"] for s in result["signals"]]))
        patch = {
            **result,
            "child_tip": child_tip,
            "analysis_status": "ok",
            "analysis_error": None,
            "analyzed_through": messages[-1].get("_id"),
            "analyzed_message_count": len(messages),
            "updated_at": now,
            "history": (previous.get("history") or [])[-19:] + [{"at": now, "risk_score": result["risk_score"], "risk_level": result["risk_level"]}],
        }
        await self.store.set_thread(thread_id, patch)

        if thread_analyzer.is_escalation(previous.get("risk_level"), result["risk_level"]):
            name = previous.get("channel_name") or thread_id
            signals = ", ".join(s["label"] for s in result["signals"][:3])
            await self.alerts.raise_alert(
                "thread_risk",
                result["risk_level"],
                f"Risk rising in chat with {name}",
                f"{result['summary']}{f' Signals: {signals}.' if signals else ''}",
                thread_id=thread_id,
                dedupe=False,
            )
            # Refresh the vetting of pending participants with the new context.
            for cid in previous.get("participants") or []:
                c = await self.store.get_contact(cid)
                if c and c.get("status") == "pending":
                    self._spawn(self.vet_contact(cid))
        return {**previous, **patch}

    # ── Contact vetting ────────────────────────────────────────────

    async def vet_contact(self, contact_id: str) -> dict | None:
        if contact_id in self._vetting:
            return None
        self._vetting.add(contact_id)
        try:
            contact = await self.store.get_contact(contact_id)
            if not contact:
                return None
            messages = await self.store.contact_messages(contact_id, limit=20)
            thread = await self.store.get_thread((contact.get("threads") or [None])[0]) if contact.get("threads") else None
            now = utcnow()
            try:
                result = await contact_vetting.vet(contact, messages, thread)
                vetting = {**result, "status": "ok", "error": None}
            except ai.AIError as exc:
                log.warning("vetting failed for %s: %s", contact_id, exc)
                vetting = {"status": "needs_review", "error": str(exc)[:300], "recommendation": None}
            vetting["vetted_at"] = now
            vetting["message_count_at_vet"] = int(contact.get("message_count") or 0)
            await self.store.set_contact(contact_id, {"vetting": vetting})

            previous = (contact.get("vetting") or {}).get("recommendation")
            if vetting.get("recommendation") == "block" and previous != "block" and contact.get("status") == "pending":
                await self.alerts.raise_alert(
                    "contact_risk",
                    "high",
                    f"We recommend blocking {contact.get('username')}",
                    vetting.get("summary") or "Their messages show warning signs.",
                    contact_id=contact_id,
                    dedupe=False,
                )
            return vetting
        finally:
            self._vetting.discard(contact_id)

    async def set_contact_status(self, contact_id: str, status: str) -> dict:
        contact_rules.validate_status(status)
        contact = await self.store.get_contact(contact_id)
        if contact is None:
            raise KeyError(contact_id)
        await self.store.set_contact(contact_id, {"status": status, "status_changed_at": utcnow()})
        updated = await self.store.set_contact_visibility(contact_id, status in contact_rules.VISIBLE_STATUSES)
        if status == "watch":
            for tid in contact.get("threads") or []:
                self._spawn(self.run_thread_analysis(tid))
        return {"contact_id": contact_id, "status": status, "messages_updated": updated}

    # ── Parent review / digest ─────────────────────────────────────

    async def review_message(self, collection: str, doc_id: str, status: str) -> dict:
        if collection not in (fs.MESSAGES, fs.SENT_MESSAGES):
            raise ValueError("invalid collection")
        if status not in ("safe", "masked", "censored", "hide_image"):
            raise ValueError("status must be safe, masked, censored, or hide_image")
        msg = await self.store.get_message(collection, doc_id)
        if msg is None:
            raise KeyError(doc_id)
        contact = await self.store.get_contact(msg.get("contact_id")) if msg.get("contact_id") else None
        contact_visible = contact is None or contact.get("status") in contact_rules.VISIBLE_STATUSES
        if status == "hide_image":
            text_risk = bool(msg.get("flagged_words")) or any(
                category.get("source") == "text" for category in (msg.get("moderation") or {}).get("categories", [])
            )
            text_status = "masked" if text_risk and msg.get("masked_content") else ("censored" if text_risk else "safe")
            atts = []
            for attachment in msg.get("attachments") or []:
                if pipeline.attachment_kind(attachment) == "image":
                    attachment = {**attachment, "url": None, "status": "censored", "flagged": True}
                atts.append(attachment)
            patch = {
                "status": text_status,
                "censored": text_status == "censored",
                "visible_to_child": contact_visible and text_status != "censored",
                "reviewed_by_parent": True,
                "reviewed_at": utcnow(),
                "attachments": atts,
                "coach_tip": None,
            }
            await self.store.update_message(collection, doc_id, patch)
            return {"doc_id": doc_id, **{k: v for k, v in patch.items() if k != "reviewed_at"}}
        patch: dict = {"status": status, "censored": status == "censored", "reviewed_by_parent": True, "reviewed_at": utcnow()}
        if status == "masked" and not msg.get("masked_content"):
            settings = await self.settings.get()
            patch["masked_content"] = text_mod.local_scan(msg.get("message") or "", settings["customKeywords"])["masked"]
        if status == "safe":
            atts = []
            for a in msg.get("attachments") or []:
                if a.get("status") in ("censored", "needs_review"):
                    url = a.get("review_url")
                    if not url and a.get("storage_path"):
                        url = await self.store.make_public(a["storage_path"])
                    if url:
                        a = {**a, "url": url, "status": "safe", "flagged": False}
                atts.append(a)
            patch["attachments"] = atts
            patch["coach_tip"] = None
            if contact is not None:
                patch["visible_to_child"] = contact_visible
        await self.store.update_message(collection, doc_id, patch)
        return {"doc_id": doc_id, **{k: v for k, v in patch.items() if k != "reviewed_at"}}

    async def generate_digest(self, days: int = 7) -> dict:
        now = utcnow()
        since = digest.period(now, days)
        messages = await self.store.messages_since(since)
        contacts = await self.store.list_contacts()
        threads = await self.store.list_threads()
        stats = digest.aggregate(messages, contacts, threads, since, now)
        settings = await self.settings.get()
        try:
            written = await digest.write_digest(stats, settings.get("childName") or "your child")
            status, error = "ok", None
        except ai.AIError as exc:
            written = {"headline": "Digest unavailable. Here are this week's numbers.", "highlights": [], "concerns": [], "positive_connections": [], "conversation_starters": []}
            status, error = "needs_review", str(exc)[:300]
        doc = {**written, "stats": stats, "period_days": days, "period_start": since, "created_at": now, "status": status, "error": error}
        doc_id = await self.store.add_digest(doc)
        return {"id": doc_id, **doc}
