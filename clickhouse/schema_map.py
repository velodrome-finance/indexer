"""Column mappings derived from schema.graphql, for entities the layer maps one to one.

The core entities (Pool, Token, UserStatsPerPool, ...) have hand-written mappings in layer.py
with analyst-friendly names. The Aero gauge / governance entities are mapped field by field:
the column name is envio's field name in snake_case (the same conversion envio's
`column_name_format: snake_case` uses), and the type follows from the GraphQL type:

  BigInt              -> Int256 (exact; precision <= 38 arrives as Decimal, above as String)
  BigInt numberOf*    -> UInt64
  Int / Boolean       -> Int32 / Bool
  Timestamp           -> DateTime64(3, 'UTC')
  String (address)    -> String, lowercased
  String / Bytes      -> String
  [String!]! / [BigInt!]!  -> Array(String) (addresses lowercased) / Array(Int256)
  relation `x: T!`    -> String column x_id
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path

SCHEMA = Path(__file__).resolve().parent.parent / "schema.graphql"

ADDRESS_NAMES = {
    "owner", "account", "caller", "recipient", "redeemer", "referral", "creator", "token", "rewardToken",
    "gaugeFactory", "votingRewardsManager", "leafVoter", "minter", "operator", "fed", "dynamicRateModule",
    "depositor", "counterparty", "migrationContract", "creationModule", "pool", "token0", "token1", "wrapper",
}


@dataclass
class Field:
    name: str
    base: str  # GraphQL scalar or type name
    required: bool
    is_list: bool
    precision: int | None
    derived: bool


def snake(name: str) -> str:
    """envio's snake_case: words split at lower->Upper and at the end of an acronym; digits stay attached."""
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name)
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", s)
    return s.lower()


def parse_schema(text: str | None = None) -> dict[str, list[Field]]:
    text = SCHEMA.read_text() if text is None else text
    types: dict[str, list[Field]] = {}
    for m in re.finditer(r"^type\s+(\w+)[^{]*\{(.*?)^\}", text, re.S | re.M):
        fields = []
        for line in m.group(2).splitlines():
            line = line.split("#", 1)[0].strip()
            fm = re.match(r"(\w+)\s*:\s*(\[?)\s*(\w+)\s*(!?)\s*\]?\s*(!?)(.*)", line)
            if not fm:
                continue
            name, lst, base, inner_req, outer_req, rest = fm.groups()
            prec = re.search(r"precision:\s*(\d+)", rest)
            fields.append(Field(name, base, bool(outer_req or (inner_req and not lst)), bool(lst),
                                int(prec.group(1)) if prec else None, "@derivedFrom" in rest))
        types[m.group(1)] = fields
    return types


def is_address(name: str) -> bool:
    return name in ADDRESS_NAMES or name.endswith("Address") or name.endswith("address")


def auto_columns(type_name: str, types: dict[str, list[Field]] | None = None):
    """Col list (layer.Col) for a type, plus the id-derived chain_id."""
    from layer import CHAIN_FROM_ID, Col  # noqa: PLC0415

    types = types or parse_schema()
    cols = [Col("id", "str", "id"), CHAIN_FROM_ID]
    for f in types[type_name]:
        if f.name in ("id", "chainId") or f.derived:
            continue
        name = snake(f.name)
        if f.is_list:
            if f.base == "BigInt":
                cols.append(Col(name, "biglist", f.name))
            else:
                cols.append(Col(name, "addrlist" if is_address(f.name) or f.name == "gauges" else "strlist", f.name))
        elif f.base == "BigInt":
            cols.append(Col(name, "count" if f.name.startswith("numberOf") else "big", f.name))
        elif f.base == "Int":
            cols.append(Col(name, "int32", f.name))
        elif f.base == "Boolean":
            cols.append(Col(name, "bool", f.name))
        elif f.base == "Timestamp":
            cols.append(Col(name, "time", f.name))
        elif f.base in ("String", "Bytes", "ID"):
            cols.append(Col(name, "addr" if is_address(f.name) else "str", f.name))
        else:  # relation to another entity: envio stores its id in <field>_id
            cols.append(Col(f"{name}_id", "str", f"{f.name}_id"))
    # a column the source table lacks is left out (older or newer schema)
    return [replace(c, optional=True) for c in cols]
