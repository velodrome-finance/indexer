-- sAERO: total staked, permanent share and voting power now, and the 10 largest positions
SELECT * FROM (
  SELECT 'total' AS row_kind, CAST(NULL AS Nullable(UInt64)) AS position, CAST(NULL AS Nullable(String)) AS holder,
         round(sum(amount)) AS aero, round(sumIf(amount, is_permanent) / sum(amount), 4) AS permanent_share,
         round(sum(voting_power_now)) AS voting_power
  FROM saero_positions
  UNION ALL
  SELECT 'position', toNullable(toUInt64(token_id)), toNullable(owner), round(amount), toFloat64(is_permanent), round(voting_power_now)
  FROM (SELECT * FROM saero_positions ORDER BY amount DESC LIMIT 10)
)
ORDER BY row_kind DESC, aero DESC;
