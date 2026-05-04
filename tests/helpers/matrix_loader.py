from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml


MATRIX_DIR = Path(__file__).resolve().parents[1] / "matrix"
CAPABILITIES_PATH = MATRIX_DIR / "capabilities.yaml"
PROFILES_PATH = MATRIX_DIR / "profiles.yaml"


@dataclass(frozen=True)
class ConnectionCase:
    id: str
    profile: str
    db_type: str
    connection_method: str
    auth_method: str
    tls_variant: str


@dataclass(frozen=True)
class InvalidCombinationCase:
    id: str
    db_type: str
    connection_method: str
    auth_method: str
    tls_variant: str
    reason: str


@lru_cache(maxsize=1)
def load_capabilities() -> dict[str, Any]:
    with CAPABILITIES_PATH.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"Invalid capabilities file: {CAPABILITIES_PATH}")
    return data


@lru_cache(maxsize=1)
def load_profiles() -> dict[str, Any]:
    with PROFILES_PATH.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"Invalid profiles file: {PROFILES_PATH}")
    return data


def query_for_db(db_type: str) -> str:
    query_map = load_capabilities().get("query_by_db", {})
    query = query_map.get(db_type)
    if not query:
        raise KeyError(f"No query configured for db_type={db_type}")
    return query


def _tls_variant_supported(db_type: str, auth_method: str, tls_variant: str) -> bool:
    # ssl_cert auth must include explicit certificate material.
    if auth_method == "ssl_cert":
        return tls_variant in {"cert_path", "cert_pem"}

    # connection_string auth handles TLS inside the raw string.
    if auth_method == "connection_string":
        return tls_variant == "none"

    if tls_variant == "none":
        return True

    if db_type in {"mysql", "postgresql"}:
        if tls_variant in {"basic_ssl", "mode_require", "cert_path", "cert_pem"}:
            return True
        return False

    if db_type == "sqlserver":
        if tls_variant in {"sqlserver_encrypt_yes", "sqlserver_encrypt_strict"}:
            return True
        return False

    return False


def _validate_profile(profile_name: str, profile_data: dict[str, Any], capabilities: dict[str, Any]) -> None:
    db_caps = capabilities.get("database_capabilities", {})
    db_types = profile_data.get("db_types", [])

    for db_type in db_types:
        if db_type not in db_caps:
            raise ValueError(f"Profile '{profile_name}' references unknown db_type '{db_type}'")

        configured_methods = profile_data.get("connection_methods", {}).get(db_type, [])
        configured_auth = profile_data.get("auth_methods", {}).get(db_type, [])

        allowed_methods = set(db_caps[db_type].get("connection_methods", []))
        allowed_auth = set(db_caps[db_type].get("auth_methods", []))

        unknown_methods = [m for m in configured_methods if m not in allowed_methods]
        unknown_auth = [a for a in configured_auth if a not in allowed_auth]

        if unknown_methods:
            raise ValueError(
                f"Profile '{profile_name}' has unsupported methods for {db_type}: {unknown_methods}"
            )
        if unknown_auth:
            raise ValueError(
                f"Profile '{profile_name}' has unsupported auth methods for {db_type}: {unknown_auth}"
            )


def build_profile_cases(profile_name: str) -> list[ConnectionCase]:
    capabilities = load_capabilities()
    profiles = load_profiles().get("profiles", {})

    if profile_name not in profiles:
        raise KeyError(f"Unknown profile '{profile_name}'")

    profile_data = profiles[profile_name]
    _validate_profile(profile_name, profile_data, capabilities)

    cases: list[ConnectionCase] = []

    for db_type in profile_data.get("db_types", []):
        methods = profile_data.get("connection_methods", {}).get(db_type, [])
        auth_methods = profile_data.get("auth_methods", {}).get(db_type, [])
        tls_variants = profile_data.get("tls_variants", {}).get(db_type, ["none"])

        for method in methods:
            for auth_method in auth_methods:
                for tls_variant in tls_variants:
                    if not _tls_variant_supported(db_type, auth_method, tls_variant):
                        continue
                    case_id = f"{profile_name}:{db_type}:{method}:{auth_method}:{tls_variant}"
                    cases.append(
                        ConnectionCase(
                            id=case_id,
                            profile=profile_name,
                            db_type=db_type,
                            connection_method=method,
                            auth_method=auth_method,
                            tls_variant=tls_variant,
                        )
                    )

    return sorted(cases, key=lambda c: c.id)


def build_invalid_cases() -> list[InvalidCombinationCase]:
    capabilities = load_capabilities()
    invalid_data = capabilities.get("invalid_combinations", [])
    if not isinstance(invalid_data, list):
        raise ValueError("invalid_combinations must be a list")

    cases: list[InvalidCombinationCase] = []
    for index, item in enumerate(invalid_data):
        db_type = item["db_type"]
        method = item["connection_method"]
        auth = item["auth_method"]
        tls_variant = item.get("tls_variant", "none")
        reason = item.get("reason", "No reason provided")

        cases.append(
            InvalidCombinationCase(
                id=f"invalid:{index}:{db_type}:{method}:{auth}:{tls_variant}",
                db_type=db_type,
                connection_method=method,
                auth_method=auth,
                tls_variant=tls_variant,
                reason=reason,
            )
        )

    return cases
