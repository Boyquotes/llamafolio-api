import { getBalancesBalances } from '@adapters/balancer/common/balance'
import type { BaseContext, Contract, GetBalancesHandler } from '@lib/adapter'
import { resolveBalances } from '@lib/balance'

import { getBalancerPools } from '../common/pool'

const vault: Contract = {
  chain: 'arbitrum',
  address: '0xba12222222228d8ba445958a75a0704d566bf2c8',
}

const url = 'https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-arbitrum-v2'

export const getContracts = async (ctx: BaseContext) => {
  const pools = await getBalancerPools(ctx, url)

  return {
    contracts: { pools, vault },
  }
}

export const getBalances: GetBalancesHandler<typeof getContracts> = async (ctx, contracts) => {
  const balances = await resolveBalances<typeof getContracts>(ctx, contracts, {
    pools: (...args) => getBalancesBalances(...args, vault),
  })

  for (const balance of balances) {
    if (balance.amount > 0n) {
      console.log(balance)
    }
  }

  return {
    groups: [{ balances }],
  }
}
