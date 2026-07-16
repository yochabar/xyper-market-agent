import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from 'viem';

export function createEvmClients(config, account) {
  const chain = {
    id: config.network.chainId,
    name: config.network.name,
    nativeCurrency: {
      name: config.network.currencySymbol,
      symbol: config.network.currencySymbol,
      decimals: 18
    },
    rpcUrls: { default: { http: [config.network.rpcUrl] } }
  };
  return {
    publicClient: createPublicClient({ chain, transport: http(config.network.rpcUrl) }),
    walletClient: createWalletClient({ account, chain, transport: http(config.network.rpcUrl) })
  };
}

export async function requireGas(config, account) {
  const { publicClient } = createEvmClients(config, account);
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) throw new Error(`wallet_needs_unit0:${account.address}`);
  return balance;
}

export function normalizeTxRequest(config, intent) {
  const txRequest = intent?.txRequest || {};
  const chainId = Number(txRequest.chainId ?? intent?.approval?.chain_id);
  if (chainId !== config.network.chainId) {
    throw new Error(`unsupported_chain:${chainId}`);
  }
  if (txRequest.to && txRequest.data) {
    return { ...txRequest, chainId };
  }

  const voucher = txRequest?.args?.voucher;
  const signature = txRequest?.args?.signature;
  if (txRequest.method !== 'acceptTweetApproval' || !txRequest.contract || !voucher || !signature) {
    throw new Error('unsupported_onchain_intent');
  }
  const abi = parseAbi([
    'function acceptTweetApproval((bytes32 approvalId,address wallet,bytes32 tweetIdHash,bytes32 twitterAccountIdHash,bytes32 contentHash,uint48 approvedAt,uint48 deadline) voucher, bytes signature)'
  ]);
  const data = encodeFunctionData({
    abi,
    functionName: 'acceptTweetApproval',
    args: [{
      approvalId: voucher.approvalId,
      wallet: voucher.wallet,
      tweetIdHash: voucher.tweetIdHash,
      twitterAccountIdHash: voucher.twitterAccountIdHash,
      contentHash: voucher.contentHash,
      approvedAt: BigInt(voucher.approvedAt),
      deadline: BigInt(voucher.deadline)
    }, signature]
  });
  return { to: txRequest.contract, data, value: txRequest.value || '0', chainId };
}

export async function sendTransaction(config, account, txRequest) {
  if (Number(txRequest.chainId) !== config.network.chainId) {
    throw new Error(`unsupported_chain:${txRequest.chainId}`);
  }
  const { walletClient, publicClient } = createEvmClients(config, account);
  const hash = await walletClient.sendTransaction({
    to: txRequest.to,
    data: txRequest.data,
    value: BigInt(txRequest.value || 0)
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
