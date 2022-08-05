import { Adapter } from "@lib/adapter";
import { getAllPools } from "./pools";
import { getGaugeBalances } from "./gauges"
import { getERC20Balances } from "@lib/erc20";


const adapter: Adapter = {
  name: "Curve",
  description:
    "A fully decentralized protocol for automated liquidity provision on Ethereum.",
  coingecko: "curve-dao-token",
  defillama: "curve",
  links: {
    website: "https://curve.fi/",
  },
  async getContracts() {
    return {
      contracts: await getAllPools(),
      revalidate: 60 * 60,
    };
  },
<<<<<<< HEAD
  async getBalances(ctx) {

    //do pools only
    let balances = await getERC20Balances(ctx, "ethereum", [ctx.contract]);
=======
  async getBalances(ctx, contracts) {

    //do pools only
    let balances = await getERC20Balances(ctx, "ethereum", contracts.map(c => c.address));
>>>>>>> 291c5a38edab944003e6ac1e0d1f9f2c5452880f

    //dont call below when getting pool balances (?)
    const gaugeBalances = await getGaugeBalances(ctx, "ethereum");
    balances = balances.concat(gaugeBalances)

    return {
      balances: balances.map((balance) => ({
        ...balance,
        category: (balance.category!== undefined) ? balance.category : "liquidity-provider",
      })),
    };
  },
};

export default adapter;
