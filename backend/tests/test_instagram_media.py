from types import SimpleNamespace

import pytest

from app.platforms.instagram import InstagramPlatform
from app.platforms.instagram import _media_url


def message(**overrides):
    fields = {
        "animated_media": None,
        "media": None,
        "visual_media": None,
        "media_share": None,
        "reel_share": None,
        "clip": None,
        "xma_share": None,
        "generic_xma": None,
        "link": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def test_extracts_shared_reel_video():
    msg = message(reel_share={"media": {"video_url": "https://cdn.example/reel.mp4"}})

    assert _media_url(msg) == ("https://cdn.example/reel.mp4", "video/mp4")


def test_extracts_nested_animated_sticker():
    msg = message(animated_media={"images": {"original": {"url": "https://cdn.example/sticker.gif"}}})

    assert _media_url(msg) == ("https://cdn.example/sticker.gif", "image/gif")


def test_extracts_giphy_link_preview_image():
    msg = message(link=SimpleNamespace(link_context=SimpleNamespace(link_image_url="https://cdn.example/giphy.gif")))

    assert _media_url(msg) == ("https://cdn.example/giphy.gif", "image/gif")


@pytest.mark.asyncio
async def test_resolves_xma_reel_page_to_cdn_video():
    class FakeClient:
        def media_pk_from_url(self, url):
            return 123

        def media_info(self, media_pk):
            assert media_pk == 123
            return SimpleNamespace(video_url="https://cdn.example/reel.mp4", resources=[])

    platform = object.__new__(InstagramPlatform)
    platform.cl = FakeClient()
    payload = {
        "message_id": "m1",
        "attachments": [{"url": "https://www.instagram.com/reel/ABC/", "type": "video/mp4"}],
    }

    await platform._resolve_shared_media(payload)

    assert payload["attachments"][0]["url"] == "https://cdn.example/reel.mp4"