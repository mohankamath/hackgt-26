import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.ai import client as ai
from app.ai import coach, contact_vetting, digest, thread_analyzer
from app.services import contacts as rules
from app.util import normalize_timestamp
from app.workers.queue import ModerationQueue

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)


# ── Timestamps ──────────────────────────────────────────────────────


def test_timestamp_aware_passthrough():
    t = datetime(2026, 9, 26, 8, 0, tzinfo=timezone(timedelta(hours=-4)))
    assert normalize_timestamp(t) == datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)


def test_timestamp_naive_local_converted():
    naive = datetime.fromtimestamp(1_790_000_000)  # how instagrapi builds DM timestamps
    assert normalize_timestamp(naive).timestamp() == 1_790_000_000


@pytest.mark.parametrize("raw", [1_790_000_000, 1_790_000_000_000, 1_790_000_000_000_000])
def test_timestamp_epoch_units(raw):
    assert normalize_timestamp(raw).timestamp() == 1_790_000_000


def test_timestamp_garbage_is_now():
    assert normalize_timestamp("nope").tzinfo is not None


# ── Contact rules ───────────────────────────────────────────────────


def test_visibility_rules():
    assert rules.visible_to_child("approved", "censored")
    assert rules.visible_to_child("watch", "safe")
    assert not rules.visible_to_child("pending", "safe")
    assert not rules.visible_to_child("blocked", "safe")
    assert not rules.visible_to_child("approved", "blocked")


def test_revet_schedule():
    c = {"status": "pending", "message_count": 1, "vetting": None}
    assert rules.should_revet(c)
    c["vetting"] = {"message_count_at_vet": 1}
    c["message_count"] = 3
    assert not rules.should_revet(c)
    c["message_count"] = 4
    assert rules.should_revet(c)
    c["status"] = "approved"
    assert not rules.should_revet(c)


def test_pfp_cache():
    c = {"pfp_moderation": {"status": "safe", "source": "https://cdn/a.png", "checked_at": NOW - timedelta(hours=1)}}
    assert rules.pfp_cache_valid(c, "https://cdn/a.png?size=128", NOW)
    assert not rules.pfp_cache_valid(c, "https://cdn/b.png", NOW)  # avatar changed
    assert not rules.pfp_cache_valid(c, "https://cdn/a.png", NOW + timedelta(days=2))  # expired
    c["pfp_moderation"]["status"] = "needs_review"
    assert not rules.pfp_cache_valid(c, "https://cdn/a.png", NOW)


def test_can_send():
    assert rules.can_send(["approved"]) == (True, None)
    assert rules.can_send(["pending"])[0] is False
    assert rules.can_send(["approved", "blocked"])[0] is False
    assert rules.can_send([])[0] is True


def test_invalid_status():
    with pytest.raises(rules.InvalidStatus):
        rules.validate_status("friend")


# ── Queue ───────────────────────────────────────────────────────────


async def test_queue_does_not_block_producers():
    started = asyncio.Event()
    release = asyncio.Event()
    done = []

    async def slow(item):
        started.set()
        await release.wait()
        done.append(item)

    q = ModerationQueue(slow, workers=2)
    await q.start()
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    for i in range(10):
        await q.enqueue(i)
    assert loop.time() - t0 < 0.05  # enqueuing 10 slow items returns immediately
    await asyncio.wait_for(started.wait(), 1)
    assert done == []
    release.set()
    await asyncio.wait_for(q.join(), 2)
    assert sorted(done) == list(range(10)) and q.processed == 10
    await q.stop()


async def test_queue_survives_handler_errors():
    async def boom(item):
        if item == 1:
            raise RuntimeError("bad")

    q = ModerationQueue(boom, workers=1)
    await q.start()
    for i in range(3):
        await q.enqueue(i)
    await asyncio.wait_for(q.join(), 2)
    assert q.processed == 2 and q.failed == 1
    await q.stop()


# ── Thread analyzer ─────────────────────────────────────────────────

MSGS = [
    {"_id": "m1", "direction": "incoming", "username": "alex", "message": "you're so mature for your age"},
    {"_id": "m2", "direction": "outgoing", "message": "haha thanks"},
    {"_id": "m3", "direction": "incoming", "username": "alex", "message": "dont tell your mom we talk ok"},
]


def test_transcript_marks_child():
    t = thread_analyzer.build_transcript(MSGS)
    assert "[m2] CHILD: haha thanks" in t and "[m1] alex:" in t


def test_parse_result_filters_bad_evidence():
    r = thread_analyzer.parse_result(
        {
            "risk_level": "high",
            "risk_score": 140,
            "signals": [
                {"type": "secrecy_request", "explanation": "asks for secrecy", "evidence_message_ids": ["m3", "zzz"]},
                {"type": "not_a_signal", "explanation": "", "evidence_message_ids": []},
            ],
            "summary": "Alex asks your child to hide the chat.",
            "recommended_action": "Talk to your child.",
        },
        {"m1", "m2", "m3"},
    )
    assert r["risk_score"] == 100
    assert r["signals"] == [
        {"type": "secrecy_request", "label": "Asks to keep secrets", "explanation": "asks for secrecy", "evidence_message_ids": ["m3"]}
    ]


def test_parse_result_malformed_raises():
    with pytest.raises(ai.AIError):
        thread_analyzer.parse_result({"risk_level": "extreme", "risk_score": 1, "signals": [], "summary": "x"}, set())
    with pytest.raises(ai.AIError):
        thread_analyzer.parse_result({"risk_level": "low", "risk_score": 1, "signals": [], "summary": ""}, set())


def test_escalation_only_upwards_to_medium_plus():
    assert thread_analyzer.is_escalation(None, "medium")
    assert thread_analyzer.is_escalation("medium", "high")
    assert not thread_analyzer.is_escalation(None, "low")
    assert not thread_analyzer.is_escalation("high", "high")
    assert not thread_analyzer.is_escalation("high", "medium")


async def test_scheduler_debounces():
    runs = []

    async def runner(tid):
        runs.append(tid)

    s = thread_analyzer.ThreadScheduler(runner, debounce_seconds=0.05)
    assert s.note_message("t1") is False  # 1 new message: not yet
    assert s.note_message("t1") is True  # 2 new messages: scheduled
    s.note_message("t1")  # burst: same scheduled run
    await asyncio.sleep(0.15)
    assert runs == ["t1"]
    assert s.note_message("t2", severity="medium") is True  # urgent: runs even for 1 message
    await asyncio.sleep(0.15)
    assert runs == ["t1", "t2"]
    await s.stop()


async def test_scheduler_outgoing_messages_do_not_trigger():
    runs = []

    async def runner(tid):
        runs.append(tid)

    s = thread_analyzer.ThreadScheduler(runner, debounce_seconds=0.01)
    for _ in range(5):
        s.note_message("t", inbound=False)
    await asyncio.sleep(0.05)
    assert runs == []
    await s.stop()


# ── Vetting ─────────────────────────────────────────────────────────


def test_vetting_parse():
    r = contact_vetting.parse_result(
        {
            "recommendation": "watch",
            "risk_level": "low",
            "summary": "Seems like a classmate.",
            "evidence": [{"point": "Mentions homework", "message_id": "m1"}, {"point": "x", "message_id": "nope"}],
            "positive_signals": ["Talks about school"],
            "suggested_parent_question": "How do you know Sam?",
        },
        {"m1"},
    )
    assert r["recommendation"] == "watch"
    assert r["evidence"][1]["message_id"] is None


def test_vetting_parse_rejects_bad_recommendation():
    with pytest.raises(ai.AIError):
        contact_vetting.parse_result({"recommendation": "maybe", "risk_level": "low", "summary": "x"}, set())


def test_vetting_prompt_mentions_flagged_pfp():
    prompt = contact_vetting.build_prompt({"platform": "discord", "username": "x", "pfp_moderation": {"status": "censored"}}, MSGS, None)
    assert "flagged as inappropriate" in prompt


# ── Coach ───────────────────────────────────────────────────────────


async def test_coach_caches_per_situation(fake_ai):
    fake_ai.completions["coach_tip"] = {"tip": "Tell a grown-up you trust."}
    assert await coach.tip_for("in:threat") == "Tell a grown-up you trust."
    await coach.tip_for("in:threat")
    assert sum(1 for c in fake_ai.calls if c["kind"] == "completion") == 1


async def test_coach_fallback_when_llm_fails(fake_ai):
    fake_ai.completions["coach_tip"] = ai.AIError("down")
    tip = await coach.tip_for("thread:secrecy_request")
    assert "secret" in tip.lower()


def test_situation_for_message():
    v = {"status": "censored", "moderation": {"categories": [{"category": "profanity", "severity": "low", "score": 1}, {"category": "harassment/threatening", "severity": "high", "score": 0.9}]}}
    assert coach.situation_for_message(v) == "in:threat"
    assert coach.situation_for_message({"status": "safe"}) is None


async def test_preview_flags_pii(fake_ai):
    fake_ai.completions["coach_tip"] = ai.AIError("offline")
    r = await coach.preview_outgoing("my address is 42 Oak Lane, come by", "balanced", [])
    assert not r["ok"]
    assert any(w["type"] == "sensitive" for w in r["warnings"])
    assert r["tip"] == coach.fallback_tip("out:pii")


async def test_preview_clean_message(fake_ai):
    r = await coach.preview_outgoing("want to play minecraft after school?", "balanced", [])
    assert r["ok"] and r["tip"] is None


# ── Digest ──────────────────────────────────────────────────────────


def test_digest_aggregate():
    since = NOW - timedelta(days=7)
    messages = [
        {"direction": "incoming", "status": "safe", "contact_id": "discord:1"},
        {"direction": "incoming", "status": "censored", "contact_id": "discord:2", "moderation": {"categories": [{"category": "sexual", "label": "Sexual content"}]}},
        {"direction": "outgoing", "status": "safe"},
    ]
    contacts = [
        {"_id": "discord:1", "username": "sam", "status": "approved", "first_seen_at": NOW - timedelta(days=30)},
        {"_id": "discord:2", "username": "stranger", "status": "pending", "first_seen_at": NOW - timedelta(days=1), "vetting": {"recommendation": "block"}},
    ]
    threads = [{"_id": "discord:9", "channel_name": "stranger", "risk_level": "high", "signals": [{"label": "Asks to keep secrets"}]}]
    s = digest.aggregate(messages, contacts, threads, since, NOW)
    assert s["messages_received"] == 2 and s["messages_sent"] == 1
    assert s["safe_rate"] == 50
    assert s["top_categories"] == {"Sexual content": 1}
    assert s["new_contacts"] == [{"username": "stranger", "status": "pending", "recommendation": "block"}]
    assert s["risky_threads"][0]["risk_level"] == "high"


def test_digest_parse_trims():
    r = digest.parse_result({"headline": "Quiet week", "highlights": ["a"] * 9, "concerns": [], "positive_connections": [], "conversation_starters": ["q1", "q2", "q3"]})
    assert len(r["highlights"]) == 4 and len(r["conversation_starters"]) == 2
