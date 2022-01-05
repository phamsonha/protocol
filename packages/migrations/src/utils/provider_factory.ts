import { LedgerEthereumClient, LedgerSubprovider, RPCSubprovider, Web3ProviderEngine, MnemonicWalletSubprovider } from '@0x/subproviders';
import { providerUtils } from '@0x/utils';
import Eth from '@ledgerhq/hw-app-eth';
// tslint:disable:no-implicit-dependencies
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import { Provider } from 'ethereum-types';
export const BASE_DERIVATION_PATH = `44'/60'/0'/0`;
export const MNEMONIC = "concert load couple harbor equip island argue ramp clarify fence smart topic";

async function ledgerEthereumNodeJsClientFactoryAsync(): Promise<LedgerEthereumClient> {
    const ledgerConnection = await TransportNodeHid.create();
    const ledgerEthClient = new Eth(ledgerConnection);
    return ledgerEthClient;
}

export const providerFactory1 = {
    async getMnemonicProviderAsync(networkId: number, rpcUrl: string): Promise<Provider> {
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

export const providerFactory = {
    async getLedgerProviderAsync(networkId: number, rpcUrl: string): Promise<Provider> {
        const provider = new Web3ProviderEngine();
        const ledgerWalletConfigs = {
            networkId,
            ledgerEthereumClientFactoryAsync: ledgerEthereumNodeJsClientFactoryAsync,
        };
        const ledgerSubprovider = new LedgerSubprovider(ledgerWalletConfigs);
        provider.addProvider(ledgerSubprovider);
        provider.addProvider(new RPCSubprovider(rpcUrl));
        providerUtils.startProviderEngine(provider);
        return provider;
    },

};
