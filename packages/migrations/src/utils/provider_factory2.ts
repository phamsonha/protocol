import { RPCSubprovider, Web3ProviderEngine, MnemonicWalletSubprovider } from '@0x/subproviders';
import { providerUtils } from '@0x/utils';
import { Provider } from 'ethereum-types';
export const BASE_DERIVATION_PATH = `44'/60'/0'/0`;
export const MNEMONIC = "";

export const providerFactory = {
    async getMnemonicProviderAsync(networkId: number, rpcUrl: string): Promise<Web3ProviderEngine> {
        const pe = new Web3ProviderEngine();
        const mnemonicWallet = new MnemonicWalletSubprovider({
            mnemonic: MNEMONIC,
            baseDerivationPath: BASE_DERIVATION_PATH,
        });
        pe.addProvider(mnemonicWallet);
        pe.addProvider(new RPCSubprovider(rpcUrl));
        providerUtils.startProviderEngine(pe);
        return pe;
    },
}

