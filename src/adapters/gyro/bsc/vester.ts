import type { BalancesContext, Contract, VestBalance } from '@lib/adapter'
import { chainById } from '@lib/chains'
import { multicall } from '@lib/multicall'
import type { Token } from '@lib/token'

const abi = {
  bondInfo: {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'bondInfo',
    outputs: [
      { internalType: 'uint256', name: 'payout', type: 'uint256' },
      { internalType: 'uint256', name: 'vesting', type: 'uint256' },
      { internalType: 'uint256', name: 'lastBlock', type: 'uint256' },
      { internalType: 'uint256', name: 'pricePaid', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
} as const

const GYRO: Token = {
  chain: 'bsc',
  address: '0x1b239abe619e74232c827fbe5e49a4c072bd869d',
  decimals: 9,
  symbol: 'GYRO',
}

export async function getGyroVesterBalances(ctx: BalancesContext, vesters: Contract[]): Promise<VestBalance[]> {
  const balances: VestBalance[] = []
  const now = Math.floor(Date.now() / 1000)

  const bondInfosRes = await multicall({
    ctx,
    calls: vesters.map((vester) => ({ target: vester.address, params: [ctx.address] }) as const),
    abi: abi.bondInfo,
  })

  for (let vesterIdx = 0; vesterIdx < vesters.length; vesterIdx++) {
    const vester = vesters[vesterIdx]
    const bondInfoRes = bondInfosRes[vesterIdx]

    if (!bondInfoRes.success) {
      continue
    }

    const [payout, _vesting, lastBlock] = bondInfoRes.output

    const client = chainById[ctx.chain].client
    const unlockAt = Number((await client.getBlock({ blockNumber: lastBlock })).timestamp)

    balances.push({
      ...vester,
      amount,
      claimable: now > unlockAt ? payout : 0n,
      unlockAt,
      decimals: 9,
      underlyings: [GYRO],
      rewards: undefined,
      category: 'vest',
    })
  }

  return balances
}
