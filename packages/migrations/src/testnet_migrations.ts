import { ContractAddresses, getContractAddressesForChainOrThrow } from '@0x/contract-addresses';
import {
    artifacts as assetProxyArtifacts,
    ChaiBridgeContract,
    DydxBridgeContract,
    ERC20BridgeProxyContract,
    Eth2DaiBridgeContract,
    KyberBridgeContract,
    UniswapBridgeContract,
} from '@0x/contracts-asset-proxy';
import { artifacts as coordinatorArtifacts, CoordinatorContract } from '@0x/contracts-coordinator';
import { artifacts as devUtilsArtifacts, DevUtilsContract } from '@0x/contracts-dev-utils';
import { artifacts as exchangeArtifacts, ExchangeContract } from '@0x/contracts-exchange';
import { artifacts as forwarderArtifacts, ForwarderContract } from '@0x/contracts-exchange-forwarder';
import {
    artifacts as multisigArtifacts,
    ZeroExGovernorContract,
    ZeroExGovernorSubmissionEventArgs,
} from '@0x/contracts-multisig';
import {
    artifacts as stakingArtifacts,
    StakingContract,
    StakingProxyContract,
    ZrxVaultContract,
} from '@0x/contracts-staking';
import { IAuthorizableContract, IOwnableContract } from '@0x/contracts-utils';
import { AbiEncoder, BigNumber, logUtils, providerUtils } from '@0x/utils';
import { LogWithDecodedArgs, SupportedProvider, TxData } from 'ethereum-types';

import { getConfigsByChainId } from './utils/configs_by_chain';
import { constants } from './utils/constants';
import { providerFactory } from './utils/provider_factory2';
import { getTimelockRegistrationsByChainId } from './utils/timelocks';
import { runMigrationsOnceAsync } from './index';


async function submitAndExecuteTransactionAsync(
    governor: ZeroExGovernorContract,
    destination: string,
    data: string,
): Promise<void> {
    const { logs } = await governor
        .submitTransaction(destination, constants.ZERO_AMOUNT, data)
        .awaitTransactionSuccessAsync();
    // tslint:disable-next-line:no-unnecessary-type-assertion
    const txId = (logs[0] as LogWithDecodedArgs<ZeroExGovernorSubmissionEventArgs>).args.transactionId;
    logUtils.log(`${txId} submitted`);
    await governor.executeTransaction(txId).awaitTransactionSuccessAsync();
    logUtils.log(`${txId} executed`);
}

/**
 * Deploys all 3.0 contracts and reconfigures existing 2.0 contracts.
 * @param supportedProvider  Web3 provider instance. Your provider instance should connect to the testnet you want to deploy to.
 * @param txDefaults Default transaction values to use when deploying contracts (e.g., specify the desired contract creator with the `from` parameter).
 */
export async function runMigrationsAsync(supportedProvider: SupportedProvider, txDefaults: TxData): Promise<void> {
    const provider = providerUtils.standardizeOrThrow(supportedProvider);
    const chainId = new BigNumber(await providerUtils.getChainIdAsync(provider));
    console.log (`chainId: ${chainId.toNumber()}`)
    const deployedAddresses = getContractAddressesForChainOrThrow(chainId.toNumber());
    const configs = getConfigsByChainId(chainId.toNumber());

    // NOTE: This must be deployed before running these migrations, since its address is hard coded in the
    // staking logic contract.
    const zrxVault = new ZrxVaultContract(deployedAddresses.zrxVault, provider, txDefaults);

    const stakingLogic = await StakingContract.deployFrom0xArtifactAsync(
        stakingArtifacts.Staking,
        provider,
        txDefaults,
        stakingArtifacts,
    );

    const exchange = await ExchangeContract.deployFrom0xArtifactAsync(
        exchangeArtifacts.Exchange,
        provider,
        txDefaults,
        exchangeArtifacts,
        chainId,
    );

    const stakingProxy = await StakingProxyContract.deployFrom0xArtifactAsync(
        stakingArtifacts.StakingProxy,
        provider,
        txDefaults,
        stakingArtifacts,
        stakingLogic.address,
    );

    const erc20BridgeProxy = await ERC20BridgeProxyContract.deployFrom0xArtifactAsync(
        assetProxyArtifacts.ERC20BridgeProxy,
        provider,
        txDefaults,
        assetProxyArtifacts,
    );

    await UniswapBridgeContract.deployFrom0xArtifactAsync(
        assetProxyArtifacts.UniswapBridge,
        provider,
        txDefaults,
        assetProxyArtifacts,
    );

    await Eth2DaiBridgeContract.deployFrom0xArtifactAsync(
        assetProxyArtifacts.Eth2DaiBridge,
        provider,
        txDefaults,
        assetProxyArtifacts,
    );

    await KyberBridgeContract.deployFrom0xArtifactAsync(
        assetProxyArtifacts.KyberBridge,
        provider,
        txDefaults,
        assetProxyArtifacts,
    );

    const chaiBridge = await ChaiBridgeContract.deployFrom0xArtifactAsync(
        assetProxyArtifacts.ChaiBridge,
        provider,
        txDefaults,
        assetProxyArtifacts,
    );

    const dydxBridge = await DydxBridgeContract.deployFrom0xArtifactAsync(
        assetProxyArtifacts.DydxBridge,
        provider,
        txDefaults,
        assetProxyArtifacts,
    );

    const authorizableInterface = new IAuthorizableContract(constants.NULL_ADDRESS, provider, txDefaults);
    const ownableInterface = new IOwnableContract(constants.NULL_ADDRESS, provider, txDefaults);

    const customTimeLocks = getTimelockRegistrationsByChainId(chainId.toNumber());

    const governor = await ZeroExGovernorContract.deployFrom0xArtifactAsync(
        multisigArtifacts.ZeroExGovernor,
        provider,
        txDefaults,
        multisigArtifacts,
        customTimeLocks.map(timeLockInfo => timeLockInfo.functionSelector),
        customTimeLocks.map(timeLockInfo => timeLockInfo.destination),
        customTimeLocks.map(timeLockInfo => timeLockInfo.secondsTimeLocked),
        configs.zeroExGovernor.owners,
        configs.zeroExGovernor.required,
        configs.zeroExGovernor.secondsTimeLocked,
    );

    logUtils.log('Configuring Exchange...');
    await exchange.setProtocolFeeCollectorAddress(stakingProxy.address).awaitTransactionSuccessAsync();
    await exchange.setProtocolFeeMultiplier(new BigNumber(150000)).awaitTransactionSuccessAsync();
    await exchange.registerAssetProxy(deployedAddresses.erc20Proxy).awaitTransactionSuccessAsync();
    await exchange.registerAssetProxy(deployedAddresses.erc721Proxy).awaitTransactionSuccessAsync();
    await exchange.registerAssetProxy(deployedAddresses.erc1155Proxy).awaitTransactionSuccessAsync();
    await exchange.registerAssetProxy(deployedAddresses.multiAssetProxy).awaitTransactionSuccessAsync();
    await exchange.registerAssetProxy(deployedAddresses.staticCallProxy).awaitTransactionSuccessAsync();
    await exchange.registerAssetProxy(erc20BridgeProxy.address).awaitTransactionSuccessAsync();
    await exchange.transferOwnership(governor.address).awaitTransactionSuccessAsync();
    logUtils.log('Exchange configured!');

    logUtils.log('Configuring ERC20BridgeProxy...');
    await erc20BridgeProxy.addAuthorizedAddress(exchange.address).awaitTransactionSuccessAsync();
    await erc20BridgeProxy.addAuthorizedAddress(deployedAddresses.multiAssetProxy).awaitTransactionSuccessAsync();
    await erc20BridgeProxy.transferOwnership(governor.address).awaitTransactionSuccessAsync();
    logUtils.log('ERC20BridgeProxy configured!');

    logUtils.log('Configuring ZrxVault...');
    await zrxVault.addAuthorizedAddress(txDefaults.from).awaitTransactionSuccessAsync();
    await zrxVault.setStakingProxy(stakingProxy.address).awaitTransactionSuccessAsync();
    await zrxVault.removeAuthorizedAddress(txDefaults.from).awaitTransactionSuccessAsync();
    await zrxVault.addAuthorizedAddress(governor.address).awaitTransactionSuccessAsync();
    await zrxVault.transferOwnership(governor.address).awaitTransactionSuccessAsync();
    logUtils.log('ZrxVault configured!');

    logUtils.log('Configuring StakingProxy...');
    await stakingProxy.addAuthorizedAddress(txDefaults.from).awaitTransactionSuccessAsync();
    const staking = new StakingContract(stakingProxy.address, provider, txDefaults);
    await staking.addExchangeAddress(exchange.address).awaitTransactionSuccessAsync();
    await stakingProxy.removeAuthorizedAddress(txDefaults.from).awaitTransactionSuccessAsync();
    await stakingProxy.addAuthorizedAddress(governor.address).awaitTransactionSuccessAsync();
    await stakingProxy.transferOwnership(governor.address).awaitTransactionSuccessAsync();
    logUtils.log('StakingProxy configured!');

    logUtils.log('Transfering ownership of 2.0 contracts...');
    const oldAssetProxyOwner = new ZeroExGovernorContract(deployedAddresses.assetProxyOwner, provider, txDefaults);
    await submitAndExecuteTransactionAsync(
        oldAssetProxyOwner,
        deployedAddresses.exchangeV2, // Exchange 2.1 address
        ownableInterface.transferOwnership(governor.address).getABIEncodedTransactionData(),
    );
    await submitAndExecuteTransactionAsync(
        oldAssetProxyOwner,
        deployedAddresses.erc20Proxy,
        ownableInterface.transferOwnership(governor.address).getABIEncodedTransactionData(),
    );
    await submitAndExecuteTransactionAsync(
        oldAssetProxyOwner,
        deployedAddresses.erc721Proxy,
        ownableInterface.transferOwnership(governor.address).getABIEncodedTransactionData(),
    );
    await submitAndExecuteTransactionAsync(
        oldAssetProxyOwner,
        deployedAddresses.erc1155Proxy,
        ownableInterface.transferOwnership(governor.address).getABIEncodedTransactionData(),
    );
    await submitAndExecuteTransactionAsync(
        oldAssetProxyOwner,
        deployedAddresses.multiAssetProxy,
        ownableInterface.transferOwnership(governor.address).getABIEncodedTransactionData(),
    );
    logUtils.log('Ownership transferred!');

    const functionCalls = [
        // AssetProxy configs
        {
            destination: deployedAddresses.erc20Proxy,
            data: authorizableInterface.addAuthorizedAddress(exchange.address).getABIEncodedTransactionData(),
        },
        {
            destination: deployedAddresses.erc20Proxy,
            data: authorizableInterface.addAuthorizedAddress(zrxVault.address).getABIEncodedTransactionData(),
        },
        {
            destination: deployedAddresses.erc721Proxy,
            data: authorizableInterface.addAuthorizedAddress(exchange.address).getABIEncodedTransactionData(),
        },
        {
            destination: deployedAddresses.erc1155Proxy,
            data: authorizableInterface.addAuthorizedAddress(exchange.address).getABIEncodedTransactionData(),
        },
        {
            destination: deployedAddresses.multiAssetProxy,
            data: authorizableInterface.addAuthorizedAddress(exchange.address).getABIEncodedTransactionData(),
        },
        {
            destination: deployedAddresses.multiAssetProxy,
            data: exchange.registerAssetProxy(erc20BridgeProxy.address).getABIEncodedTransactionData(),
        },
    ];

    const batchTransactionEncoder = AbiEncoder.create('(bytes[],address[],uint256[])');
    const batchTransactionData = batchTransactionEncoder.encode([
        functionCalls.map(item => item.data),
        functionCalls.map(item => item.destination),
        functionCalls.map(() => constants.ZERO_AMOUNT),
    ]);
    await submitAndExecuteTransactionAsync(governor, governor.address, batchTransactionData);

    await DevUtilsContract.deployWithLibrariesFrom0xArtifactAsync(
        devUtilsArtifacts.DevUtils,
        devUtilsArtifacts,
        provider,
        txDefaults,
        devUtilsArtifacts,
        exchange.address,
        chaiBridge.address,
        dydxBridge.address,
    );

    await CoordinatorContract.deployFrom0xArtifactAsync(
        coordinatorArtifacts.Coordinator,
        provider,
        txDefaults,
        coordinatorArtifacts,
        exchange.address,
        chainId,
    );

    await ForwarderContract.deployFrom0xArtifactAsync(
        forwarderArtifacts.Forwarder,
        provider,
        txDefaults,
        forwarderArtifacts,
        exchange.address,
        deployedAddresses.exchangeV2,
        deployedAddresses.etherToken,
    );
}

(async () => {
    console.log ("Start testnet_migrations")
    const networkId = 97;
    const rpcUrl = 'https://bsc.getblock.io/testnet/?api_key=4c453762-efec-4819-9733-72be1d6ce1e4';
    const provider = await providerFactory.getMnemonicProviderAsync(networkId, rpcUrl);
    // await runMigrationsAsync(provider, { from: '0x753D9799e55852a9b86143E710EdE5510259fDb3', gasPrice: 10000000001 });
    const txDefaults = { from: '0x753D9799e55852a9b86143E710EdE5510259fDb3', gasPrice: 10000000001 };
    let contract = await runMigrationsOnceAsync (provider, txDefaults)
    console.log (contract)
})().catch(err => {
    logUtils.log(err);
    process.exit(1);
});
