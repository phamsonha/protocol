import { devConstants, web3Factory } from '@0x/dev-utils';
import { Web3ProviderEngine } from '@0x/subproviders';
import { Web3Wrapper } from '@0x/web3-wrapper';

const txDefaults = {
    from: devConstants.TESTRPC_FIRST_ADDRESS,
    gas: devConstants.GAS_LIMIT,
};
const provider: Web3ProviderEngine = web3Factory.getRpcProvider({ shouldUseInProcessGanache: false, rpcUrl: "http://127.0.0.1:8545" });
const web3Wrapper = new Web3Wrapper(provider);

export { provider, web3Wrapper, txDefaults };
