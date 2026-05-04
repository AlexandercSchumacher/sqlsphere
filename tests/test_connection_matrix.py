from __future__ import annotations

import json
from typing import Any

import pytest

from tests.helpers.matrix_loader import (
    ConnectionCase,
    build_invalid_cases,
    build_profile_cases,
    query_for_db,
)
from tests.helpers.payload_builder import build_connect_payload, build_invalid_connect_payload


CORE_CASES = build_profile_cases("core")
CORE_WINDOWS_SQLSERVER_CASES = [
    case
    for case in CORE_CASES
    if case.db_type == "sqlserver"
    and (case.connection_method == "pipe" or case.tls_variant == "sqlserver_encrypt_strict")
]
AWS_CASES = build_profile_cases("aws")
AZURE_CASES = build_profile_cases("azure_ad")
KERBEROS_CASES = build_profile_cases("kerberos_windows")
CI_TLS_CONNECTION_STRING_CASES = build_profile_cases("ci_tls_connection_string")
CI_SSH_CASES = build_profile_cases("ci_ssh")
INVALID_CASES = build_invalid_cases()


def _redact(payload: dict[str, Any]) -> dict[str, Any]:
    sensitive_keys = {
        "password",
        "ssh_password",
        "azure_client_secret",
        "aws_secret_access_key",
        "connection_string_value",
        "ssl_key",
    }
    redacted: dict[str, Any] = {}
    for key, value in payload.items():
        if key in sensitive_keys and value:
            redacted[key] = "***"
        else:
            redacted[key] = value
    return redacted


def _execute_positive_case(case: ConnectionCase, api_client, auth_headers: dict[str, str]) -> None:
    connect = build_connect_payload(case)
    if connect.missing_requirements:
        pytest.skip("; ".join(connect.missing_requirements))

    connect_response = api_client.post("/connect", json=connect.payload, headers=auth_headers)
    assert connect_response.status_code == 200, (
        f"/connect failed for case={case.id}\n"
        f"payload={json.dumps(_redact(connect.payload), indent=2, sort_keys=True)}\n"
        f"response={connect_response.text}"
    )

    connect_body = connect_response.json()
    assert connect_body.get("success") is True, f"unexpected /connect body: {connect_body}"

    session_id = connect_body.get("session_id")
    assert isinstance(session_id, str) and session_id, f"missing session_id in /connect response: {connect_body}"

    query_response = api_client.post(
        "/query",
        json={
            "session_id": session_id,
            "query": query_for_db(case.db_type),
        },
        headers=auth_headers,
    )
    assert query_response.status_code == 200, (
        f"/query failed for case={case.id}\n"
        f"response={query_response.text}"
    )

    query_body = query_response.json()
    assert query_body.get("success") is True, f"unexpected /query body: {query_body}"


@pytest.mark.core
@pytest.mark.parametrize("case", CORE_CASES, ids=lambda c: c.id)
def test_connection_matrix_core(case: ConnectionCase, api_client, auth_headers: dict[str, str]) -> None:
    _execute_positive_case(case, api_client, auth_headers)


@pytest.mark.core_windows_sqlserver
@pytest.mark.parametrize("case", CORE_WINDOWS_SQLSERVER_CASES, ids=lambda c: c.id)
def test_connection_matrix_core_windows_sqlserver(
    case: ConnectionCase,
    api_client,
    auth_headers: dict[str, str],
) -> None:
    _execute_positive_case(case, api_client, auth_headers)


@pytest.mark.aws
@pytest.mark.parametrize("case", AWS_CASES, ids=lambda c: c.id)
def test_connection_matrix_aws(case: ConnectionCase, api_client, auth_headers: dict[str, str]) -> None:
    _execute_positive_case(case, api_client, auth_headers)


@pytest.mark.azure_ad
@pytest.mark.parametrize("case", AZURE_CASES, ids=lambda c: c.id)
def test_connection_matrix_azure_ad(case: ConnectionCase, api_client, auth_headers: dict[str, str]) -> None:
    _execute_positive_case(case, api_client, auth_headers)


@pytest.mark.kerberos_windows
@pytest.mark.parametrize("case", KERBEROS_CASES, ids=lambda c: c.id)
def test_connection_matrix_kerberos_windows(case: ConnectionCase, api_client, auth_headers: dict[str, str]) -> None:
    _execute_positive_case(case, api_client, auth_headers)


@pytest.mark.ci_tls_connection_string
@pytest.mark.parametrize("case", CI_TLS_CONNECTION_STRING_CASES, ids=lambda c: c.id)
def test_connection_matrix_ci_tls_connection_string(case: ConnectionCase, api_client, auth_headers: dict[str, str]) -> None:
    _execute_positive_case(case, api_client, auth_headers)


@pytest.mark.ci_ssh
@pytest.mark.parametrize("case", CI_SSH_CASES, ids=lambda c: c.id)
def test_connection_matrix_ci_ssh(case: ConnectionCase, api_client, auth_headers: dict[str, str]) -> None:
    _execute_positive_case(case, api_client, auth_headers)


@pytest.mark.core
@pytest.mark.parametrize("case", INVALID_CASES, ids=lambda c: c.id)
def test_invalid_combinations_are_rejected(case, api_client, auth_headers: dict[str, str]) -> None:
    payload = build_invalid_connect_payload(case)
    response = api_client.post("/connect", json=payload, headers=auth_headers)

    assert response.status_code in {400, 422}, (
        f"expected invalid combination to be rejected for case={case.id}\n"
        f"reason={case.reason}\n"
        f"payload={json.dumps(_redact(payload), indent=2, sort_keys=True)}\n"
        f"status={response.status_code}\n"
        f"response={response.text}"
    )


def test_profile_generation_not_empty() -> None:
    assert CORE_CASES, "core profile generated no cases"
    assert CORE_WINDOWS_SQLSERVER_CASES, "core windows sqlserver cases generated no cases"
    assert AWS_CASES, "aws profile generated no cases"
    assert AZURE_CASES, "azure_ad profile generated no cases"
    assert KERBEROS_CASES, "kerberos_windows profile generated no cases"
    assert CI_TLS_CONNECTION_STRING_CASES, "ci_tls_connection_string profile generated no cases"
    assert CI_SSH_CASES, "ci_ssh profile generated no cases"
