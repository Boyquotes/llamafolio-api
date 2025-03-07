import { selectTokenHoldersBalances } from '@db/balances'
import { client } from '@db/clickhouse'
import { badRequest, serverError, success } from '@handlers/response'
import { chainByChainId, getChainId } from '@lib/chains'
import { parseAddress } from '@lib/fmt'
import { mulPrice } from '@lib/math'
import { getTokenPrice } from '@lib/price'
import type { Token } from '@lib/token'
import type { APIGatewayProxyHandler } from 'aws-lambda'

interface Holder {
  address: string
  amount: string
  balanceUSD?: number
}

interface TokenHoldersResponse {
  holders: Holder[]
  count: number
  next: number
}

export const handler: APIGatewayProxyHandler = async (event, _context) => {
  // Token address
  const address = parseAddress(event.pathParameters?.address || '')
  if (!address) {
    return badRequest('Invalid address parameter')
  }

  const offset = Math.max(parseInt(event.queryStringParameters?.offset ?? '0'), 0)
  const limit = Math.min(parseInt(event.queryStringParameters?.limit ?? '100'), 100)

  const chainId = getChainId(event.queryStringParameters?.chain || 'ethereum')
  if (chainId == null) {
    return badRequest(`Unknown chain ${event.queryStringParameters?.chain}`)
  }

  try {
    const [tokenHoldersBalances, tokenPrice] = await Promise.all([
      selectTokenHoldersBalances(client, address, chainId, limit, offset),
      getTokenPrice({ chain: chainByChainId[chainId].id, address } as Token),
    ])

    let count = 0
    const holders: Holder[] = []

    for (const row of tokenHoldersBalances) {
      count = parseInt(row.count)

      holders.push({
        address: row.holder,
        amount: row.value,
        balanceUSD:
          tokenPrice?.price != null && tokenPrice?.decimals != null
            ? mulPrice(BigInt(row.value), tokenPrice.decimals, tokenPrice.price)
            : undefined,
      })
    }

    const response: TokenHoldersResponse = {
      holders,
      count,
      next: Math.min(offset + limit, count),
    }

    return success(response, { maxAge: 10 * 60 })
  } catch (e) {
    console.error('Failed to retrieve token holders', e)
    return serverError('Failed to retrieve token holders')
  }
}
