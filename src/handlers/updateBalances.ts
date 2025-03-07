import { adapterById } from '@adapters/index'
import type { ClickHouseClient } from '@clickhouse/client'
import { formatBalance, insertBalances } from '@db/balances'
import { client } from '@db/clickhouse'
import { getContractsInteractions, groupContracts } from '@db/contracts'
import { badRequest, serverError, success } from '@handlers/response'
import type { Balance, BalancesContext } from '@lib/adapter'
import { groupBy, groupBy2 } from '@lib/array'
import {
  BALANCE_UPDATE_THRESHOLD_SEC,
  fmtBalanceBreakdown,
  resolveHealthFactor,
  sanitizeBalances,
  sanitizePricedBalances,
} from '@lib/balance'
import { type Chain, chains } from '@lib/chains'
import { parseAddresses, unixFromDate } from '@lib/fmt'
import { getPricedBalances } from '@lib/price'
import type { APIGatewayProxyHandler } from 'aws-lambda'

type AdapterBalance = Balance & {
  groupIdx: number
  adapterId: string
  timestamp: Date
  healthFactor: number
  fromAddress: string
}

// Update Balances
// NOTE: doesn't return aggregated result
export async function updateBalances(client: ClickHouseClient, address: `0x${string}`) {
  // Fetch all protocols (with their associated contracts) that the user interacted with
  // and all unique tokens he received
  const contracts = await getContractsInteractions(client, address)

  const contractsByAdapterIdChain = groupBy2(contracts, 'adapterId', 'chain')

  // add wallet adapter on each chain to force run wallet adapter (for non-indexed chains and gas tokens)
  for (const chain of chains) {
    if (!contractsByAdapterIdChain.wallet) {
      contractsByAdapterIdChain.wallet = {}
    }
    if (!contractsByAdapterIdChain.wallet[chain.id]) {
      contractsByAdapterIdChain.wallet[chain.id] = []
    }
  }

  const adapterIds = Object.keys(contractsByAdapterIdChain)
  // list of all [adapterId, chain]
  const adapterIdsChains = adapterIds.flatMap((adapterId) =>
    Object.keys(contractsByAdapterIdChain[adapterId]).map((chain) => [adapterId, chain] as [string, Chain]),
  )

  console.log('Interacted with protocols:', adapterIds)

  const now = new Date()
  const balances: AdapterBalance[] = []

  // Run adapters `getBalances` only with the contracts the user interacted with
  await Promise.all(
    adapterIdsChains.map(async ([adapterId, chain]) => {
      const adapter = adapterById[adapterId]
      if (!adapter) {
        console.error(`Could not find adapter with id`, adapterId)
        return
      }
      const handler = adapter[chain]
      if (!handler) {
        console.error(`Could not find chain handler for`, [adapterId, chain])
        return
      }

      try {
        const hrstart = process.hrtime()

        const contracts = groupContracts(contractsByAdapterIdChain[adapterId][chain]) || []

        const ctx: BalancesContext = { address, chain, adapterId }

        const balancesConfig = await handler.getBalances(ctx, contracts)

        const hrend = process.hrtime(hrstart)

        let balancesLength = 0

        for (let groupIdx = 0; groupIdx < balancesConfig.groups.length; groupIdx++) {
          const group = balancesConfig.groups[groupIdx]
          for (const balance of group.balances) {
            balancesLength++

            // use token when available
            balance.address = (balance.token || balance.address).toLowerCase()
            // metadata
            balance.groupIdx = groupIdx
            balance.adapterId = adapterId
            balance.timestamp = now
            balance.healthFactor = group.healthFactor
            balance.fromAddress = address

            balances.push(balance)
          }
        }

        console.log(
          `[${adapterId}][${chain}] getBalances ${contractsByAdapterIdChain[adapterId][chain].length} contracts, found ${balancesLength} balances in %ds %dms`,
          hrend[0],
          hrend[1] / 1000000,
        )
      } catch (error) {
        console.error(`[${adapterId}][${chain}]: Failed to getBalances`, error)
      }
    }),
  )

  const sanitizedBalances = sanitizeBalances(balances)

  const hrstart = process.hrtime()

  const pricedBalances = await getPricedBalances(sanitizedBalances)

  const sanitizedPricedBalances = sanitizePricedBalances(pricedBalances)

  const hrend = process.hrtime(hrstart)

  console.log(
    `getPricedBalances ${sanitizedBalances.length} balances, found ${balances.length} balances, ${sanitizedPricedBalances.length} sanitized in %ds %dms`,
    hrend[0],
    hrend[1] / 1000000,
  )

  const balancesWithBreakdown = sanitizedPricedBalances.map(fmtBalanceBreakdown)

  const dbBalances: any[] = []

  // Group back
  const balancesByChain = groupBy(balancesWithBreakdown, 'chain')

  for (const chain in balancesByChain) {
    const balancesByProtocol = groupBy(balancesByChain[chain], 'adapterId')

    for (const protocolId in balancesByProtocol) {
      const balances = balancesByProtocol[protocolId]
      const balancesByGroupIdx = groupBy(balances, 'groupIdx')

      for (const groupIdx in balancesByGroupIdx) {
        const groupBalances = balancesByGroupIdx[groupIdx].map(formatBalance)
        const healthFactor = balancesByGroupIdx[groupIdx]?.[0]?.healthFactor || resolveHealthFactor(groupBalances)

        for (const balance of balancesByGroupIdx[groupIdx]) {
          dbBalances.push({ ...balance, healthFactor })
        }
      }
    }
  }

  await insertBalances(client, dbBalances)

  return { updatedAt: unixFromDate(new Date()) }
}

export const handler: APIGatewayProxyHandler = async (event) => {
  const addresses = parseAddresses(event.pathParameters?.address || '')
  console.log('Get balances', addresses)
  if (addresses.length === 0) {
    return badRequest('Invalid address parameter')
  }

  try {
    await Promise.all(addresses.map((address) => updateBalances(client, address)))

    const updatedAt = unixFromDate(new Date())

    return success({
      status: 'success',
      updatedAt,
      nextUpdateAt: updatedAt + BALANCE_UPDATE_THRESHOLD_SEC,
    })
  } catch (e) {
    console.error('Failed to update balances', e)
    return serverError('Failed to update balances')
  }
}
