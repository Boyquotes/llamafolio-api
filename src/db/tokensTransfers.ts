import type { ClickHouseClient } from '@clickhouse/client'
import { unixFromDateTime } from '@lib/fmt'

export async function selectLatestTokensTransfers(
  client: ClickHouseClient,
  chainId: number,
  address: string,
  limit: number,
  offset: number,
  window: 'd' | 'w' | 'm',
) {
  const hours: { [key in 'd' | 'w' | 'm']: number } = {
    d: 24,
    w: 24 * 7,
    m: 24 * 30,
  }

  const interval = hours[window] || 24

  const queryRes = await client.query({
    query: `
      WITH "latest_tokens_transfers" AS (
        SELECT
          "timestamp",
          "transaction_hash",
          "log_index",
          "from_address",
          "to_address",
          "value"
      FROM evm_indexer2.token_transfers
      WHERE
        "chain" = {chainId: UInt64} AND
        "timestamp" >= now() - interval {interval: UInt16} hour AND
        "address_short" = substring({address: String}, 1, 10) AND
        "address" = {address: String}
      GROUP BY "timestamp", "transaction_hash", "log_index", "from_address", "to_address", "value"
      ),
      (
        SELECT count() FROM "latest_tokens_transfers"
      ) AS "count",
      (
        SELECT max("timestamp") FROM evm_indexer2.blocks
        WHERE "chain" = {chainId: UInt64}
      ) AS "updated_at"
      SELECT
        *,
        "count",
        "updated_at"
      FROM "latest_tokens_transfers"
      ORDER BY "timestamp" DESC
      LIMIT {limit: UInt8}
      OFFSET {offset: UInt32};
    `,
    query_params: {
      chainId,
      address,
      limit,
      offset,
      interval,
    },
  })

  const res = (await queryRes.json()) as {
    data: {
      timestamp: string
      transaction_hash: string
      log_index: string
      from_address: string
      to_address: string
      value: string
      count: string
      updated_at: string
    }[]
  }

  return res.data.map((row) => ({
    transactionHash: row.transaction_hash,
    logIndex: parseInt(row.log_index),
    fromAddress: row.from_address,
    toAddress: row.to_address,
    amount: row.value,
    count: parseInt(row.count),
    timestamp: unixFromDateTime(row.timestamp),
    updatedAt: unixFromDateTime(row.updated_at),
  }))
}
