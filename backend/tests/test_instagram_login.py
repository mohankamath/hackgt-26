"""Instagram login strategy tests with a fake instagrapi client (no network)."""

import json

import pytest
from instagrapi.exceptions import ChallengeRequired, LoginRequired, TwoFactorRequired

from app.platforms.instagram import InstagramPlatform


class FakeClient:
    instances: list["FakeClient"] = []

    def __init__(self):
        self.calls: list[tuple] = []
        self.username = None
        self.user_id = None
        self.sessionid_error: Exception | None = None
        self.login_error: Exception | None = None
        self.device_settings = {"android_version": 34}
        FakeClient.instances.append(self)

    def load_settings(self, path, override_app_version=False):
        self.calls.append(("load_settings", override_app_version))
        data = json.loads(open(path).read())
        self.user_id = data.get("user_id")
        self.device_settings = data.get("device_settings", {"android_version": 34})

    def dump_settings(self, path):
        self.calls.append(("dump_settings",))
        with open(path, "w") as f:
            json.dump({"user_id": self.user_id or "42"}, f)

    def set_device(self, d):
        self.calls.append(("set_device",))

    def set_user_agent(self, ua):
        self.calls.append(("set_user_agent",))

    def login_by_sessionid(self, sid):
        self.calls.append(("login_by_sessionid", sid))
        if self.sessionid_error:
            raise self.sessionid_error
        self.user_id = "42"

    def login(self, username, password, relogin=False, verification_code=""):
        self.calls.append(("login", username, relogin, verification_code))
        if self.login_error:
            raise self.login_error
        self.username, self.user_id = username, "42"

    account_info_error: Exception | None = None

    def account_info(self):
        self.calls.append(("account_info",))
        if self.account_info_error:
            raise self.account_info_error

    def totp_generate_code(self, seed):
        return "123456"


class Svc:
    class store:
        @staticmethod
        async def existing_message_ids(platform):
            return set()


def make(tmp_path, **kw):
    FakeClient.instances.clear()
    return InstagramPlatform(Svc(), session_file=tmp_path / "session.json", client_factory=FakeClient, **kw)


def names(ig):
    return [c[0] for c in ig.cl.calls]


def test_password_login_saves_session(tmp_path):
    ig = make(tmp_path, username="kid", password="pw")
    assert ig.login_sync() == "password"
    assert names(ig) == ["login", "dump_settings"]
    assert (tmp_path / "session.json").exists()
    assert oct((tmp_path / "session.json").stat().st_mode & 0o777) == "0o600"


def test_restart_reuses_saved_session(tmp_path):
    (tmp_path / "session.json").write_text(json.dumps({"user_id": "42"}))
    ig = make(tmp_path, username="kid", password="pw")
    assert ig.login_sync() == "saved session + password"
    assert ig.cl.calls[0] == ("load_settings", True)
    # login() is still called, but instagrapi validates the loaded session instead of re-authing
    assert ig.cl.calls[1] == ("login", "kid", False, "")


def test_sessionid_preferred_when_set(tmp_path):
    ig = make(tmp_path, session_id="abc", username="kid", password="pw")
    assert ig.login_sync() == "sessionid"
    assert "login" not in names(ig)


def test_no_device_override_in_any_mode(tmp_path):
    ig = make(tmp_path, session_id="abc")
    ig.login_sync()
    assert "set_device" not in names(ig) and "set_user_agent" not in names(ig)


def test_stale_device_session_is_discarded(tmp_path):
    # Session saved by the old code: Galaxy Note 8 on Android 8.0 -> "app out of date"
    (tmp_path / "session.json").write_text(json.dumps({"user_id": "42", "device_settings": {"android_version": 26}}))
    ig = make(tmp_path, username="kid", password="pw")
    assert ig.login_sync() == "password"
    assert (tmp_path / "session.json.stale").exists()
    assert len(FakeClient.instances) == 2  # fresh client with the default device
    assert ig.cl.device_settings["android_version"] == 34


def test_outdated_error_message():
    msg = InstagramPlatform.describe_login_error(Exception("Your version of Instagram is out of date."))
    assert "instagram_session.json" in msg


def test_bad_sessionid_falls_back_to_password(tmp_path):
    ig = make(tmp_path, session_id="abc", username="kid", password="pw")
    ig.cl.sessionid_error = LoginRequired("nope")
    assert ig.login_sync() == "password"
    assert names(ig) == ["login_by_sessionid", "login", "dump_settings"]  # failed before account_info


def test_sessionid_rejected_by_private_api_falls_back(tmp_path):
    # login_by_sessionid "works" but the first authenticated call says login_required
    ig = make(tmp_path, session_id="browser-cookie", username="kid", password="pw")
    ig.cl.account_info_error = LoginRequired("login_required")
    assert ig.login_sync() == "password"
    assert names(ig) == ["login_by_sessionid", "account_info", "login", "dump_settings"]


def test_bad_sessionid_without_password_raises(tmp_path):
    ig = make(tmp_path, session_id="abc")
    ig.cl.sessionid_error = LoginRequired("nope")
    with pytest.raises(LoginRequired):
        ig.login_sync()


def test_totp_code_passed(tmp_path):
    ig = make(tmp_path, username="kid", password="pw", totp_seed="SEED")
    ig.login_sync()
    assert ig.cl.calls[0] == ("login", "kid", False, "123456")


def test_corrupt_session_file_is_ignored(tmp_path):
    (tmp_path / "session.json").write_text("{not json")
    ig = make(tmp_path, username="kid", password="pw")
    assert ig.login_sync() == "password"
    assert len(FakeClient.instances) == 2  # fresh client after the bad load


def test_friendly_errors():
    assert "INSTAGRAM_TOTP_SEED" in InstagramPlatform.describe_login_error(TwoFactorRequired("2fa"))
    assert "approve" in InstagramPlatform.describe_login_error(ChallengeRequired("c"))


async def test_start_reports_error(tmp_path):
    ig = make(tmp_path, username="kid", password="pw")
    ig.cl.login_error = TwoFactorRequired("2fa")
    await ig.start()
    assert not ig.is_running and "2FA" in ig.error


async def test_login_required_while_polling_relogs_once(tmp_path):
    ig = make(tmp_path, username="kid", password="pw")
    assert await ig._handle_login_required() is True
    assert ("login", "kid", True, "") in ig.cl.calls

    ig2 = make(tmp_path, session_id="abc")
    assert await ig2._handle_login_required() is False
    assert "INSTAGRAM_SESSION_ID" in ig2.error


def test_config_enables_instagram_with_password():
    from app.config import Config

    assert Config(instagram_username="u", instagram_password="p").instagram_enabled
    assert not Config(instagram_username="u").instagram_enabled
    assert Config(instagram_session_id="s").instagram_enabled
