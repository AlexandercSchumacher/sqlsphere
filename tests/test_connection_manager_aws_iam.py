from __future__ import annotations

import connection_manager
from models import DatabaseConnection


class _DummyTunnel:
    def __init__(self, local_bind_port: int = 45555) -> None:
        self.local_bind_port = local_bind_port

    def stop(self) -> None:
        pass


class _DummyConnection:
    def close(self) -> None:
        pass


class _DummyMySQLConnection:
    def __init__(self) -> None:
        self.autocommit = False

    def close(self) -> None:
        pass


def test_aws_iam_token_uses_remote_host_when_connection_method_is_ssh(monkeypatch) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr(connection_manager, "_create_ssh_tunnel", lambda _params: _DummyTunnel())
    monkeypatch.setattr(connection_manager.pyodbc, "connect", lambda *_args, **_kwargs: _DummyConnection())
    monkeypatch.setattr(connection_manager.mysql.connector, "connect", lambda **_kwargs: _DummyMySQLConnection())

    def _fake_generate_token(
        host: str,
        port: int,
        username: str,
        region: str,
        aws_access_key_id: str | None = None,
        aws_secret_access_key: str | None = None,
    ) -> str:
        captured["host"] = host
        captured["port"] = port
        captured["username"] = username
        captured["region"] = region
        captured["aws_access_key_id"] = aws_access_key_id
        captured["aws_secret_access_key"] = aws_secret_access_key
        return "iam-token"

    monkeypatch.setattr(connection_manager, "_generate_aws_iam_token", _fake_generate_token)

    params = DatabaseConnection(
        type="mysql",
        connection_method="ssh",
        host="test-mysql.aaaaaaaaaaaa.eu-central-1.rds.amazonaws.com",
        port=3306,
        database="test_mysql_db",
        username="test_admin",
        password="",
        auth_method="aws_iam",
        aws_region="eu-central-1",
        aws_access_key_id="dummy-access-key",
        aws_secret_access_key="dummy-secret-key",
        use_ssl=True,
        ssh_host="192.0.2.10",
        ssh_port=22,
        ssh_username="ec2-user",
        ssh_key_file="/tmp/sqlsphere-test-key.pem",
    )

    conn, engine = connection_manager.connect_with_params(params)
    conn.close()

    assert engine == "mysql"
    assert captured["host"] == params.host
    assert captured["port"] == params.port
    assert captured["username"] == params.username
    assert captured["region"] == params.aws_region


def test_mysql_aws_iam_prefers_mysql_connector_over_pyodbc(monkeypatch) -> None:
    calls: dict[str, object] = {"pyodbc_called": False, "mysql_kwargs": None}

    monkeypatch.setattr(connection_manager, "_create_ssh_tunnel", lambda _params: _DummyTunnel())

    def _fake_generate_token(*_args, **_kwargs) -> str:
        return "iam-token"

    monkeypatch.setattr(connection_manager, "_generate_aws_iam_token", _fake_generate_token)

    def _fake_pyodbc_connect(*_args, **_kwargs):
        calls["pyodbc_called"] = True
        raise AssertionError("pyodbc.connect should not be used for mysql aws_iam connections")

    monkeypatch.setattr(connection_manager.pyodbc, "connect", _fake_pyodbc_connect)

    def _fake_mysql_connect(**kwargs):
        calls["mysql_kwargs"] = kwargs
        return _DummyMySQLConnection()

    monkeypatch.setattr(connection_manager.mysql.connector, "connect", _fake_mysql_connect)

    params = DatabaseConnection(
        type="mysql",
        connection_method="ssh",
        host="test-mysql.aaaaaaaaaaaa.eu-central-1.rds.amazonaws.com",
        port=3306,
        database="test_mysql_db",
        username="test_admin",
        password="",
        auth_method="aws_iam",
        aws_region="eu-central-1",
        aws_access_key_id="dummy-access-key",
        aws_secret_access_key="dummy-secret-key",
        use_ssl=True,
        ssh_host="192.0.2.10",
        ssh_port=22,
        ssh_username="ec2-user",
        ssh_key_file="/tmp/sqlsphere-test-key.pem",
    )

    conn, engine = connection_manager.connect_with_params(params)
    conn.close()

    assert engine == "mysql"
    assert calls["pyodbc_called"] is False
    mysql_kwargs = calls["mysql_kwargs"]
    assert isinstance(mysql_kwargs, dict)
    assert mysql_kwargs.get("auth_plugin") == "mysql_clear_password"
    assert mysql_kwargs.get("use_pure") is True
    assert mysql_kwargs.get("connection_timeout") == 15


def test_aws_iam_requires_access_keys_when_instance_profile_disabled(monkeypatch) -> None:
    monkeypatch.setattr(connection_manager, "_create_ssh_tunnel", lambda _params: None)
    called = {"token_called": False}

    def _fake_generate_token(*_args, **_kwargs) -> str:
        called["token_called"] = True
        return "iam-token"

    monkeypatch.setattr(connection_manager, "_generate_aws_iam_token", _fake_generate_token)

    params = DatabaseConnection(
        type="mysql",
        connection_method="standard",
        host="test-mysql.aaaaaaaaaaaa.eu-central-1.rds.amazonaws.com",
        port=3306,
        database="test_mysql_db",
        username="test_iam_user",
        password="",
        auth_method="aws_iam",
        aws_region="eu-central-1",
        aws_use_instance_profile=False,
        aws_access_key_id="",
        aws_secret_access_key="",
        use_ssl=True,
    )

    try:
        connection_manager.connect_with_params(params)
    except ValueError as exc:
        assert "awsAccessKeyId and awsSecretAccessKey are required" in str(exc)
    else:
        raise AssertionError("Expected ValueError for missing AWS access key credentials")

    assert called["token_called"] is False
