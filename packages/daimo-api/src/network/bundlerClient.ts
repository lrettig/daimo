import { UserOpHex, assert } from "@daimo/common";
import { BundlerJsonRpcProvider, Constants } from "userop";
import { Hex, hexToBigInt, isHex } from "viem";

interface GasEstimate {
  preVerificationGas: Hex;
}

interface GasPriceParams {
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
}

interface GasPrice {
  slow: GasPriceParams;
  standard: GasPriceParams;
  fast: GasPriceParams;
}

/** Sends userops through an ERC-4337 bundler. */
export class BundlerClient {
  provider: BundlerJsonRpcProvider;

  constructor(bundlerRpcUrl: string) {
    this.provider = new BundlerJsonRpcProvider(bundlerRpcUrl);
  }

  async sendUserOp(op: UserOpHex) {
    console.log(`[BUNDLER] submitting userOp: ${JSON.stringify(op)}`);
    const args = [op, Constants.ERC4337.EntryPoint];
    const opHash = await this.provider.send("eth_sendUserOperation", args);
    assert(isHex(opHash));
    console.log(`[BUNDLER] submitted userOpHash: ${opHash}`);
    return opHash;
  }

  async estimatePreVerificationGas(op: UserOpHex) {
    const args = [op, Constants.ERC4337.EntryPoint];
    const gasEstimate = (await this.provider.send(
      "eth_estimateUserOperationGas",
      args
    )) as GasEstimate;
    console.log(
      `[BUNDLER] estimated userOp gas: ${JSON.stringify(op)}: ${JSON.stringify(
        gasEstimate
      )}`
    );
    assert(isHex(gasEstimate.preVerificationGas));
    return hexToBigInt(gasEstimate.preVerificationGas);
  }

  async getUserOperationGasPriceParams() {
    console.log(`[BUNDLER] fetching gas price params`);
    const gasPrice = (await this.provider.send(
      "pimlico_getUserOperationGasPrice",
      []
    )) as GasPrice;
    console.log(
      `[BUNDLER] fetched gas price params: ${JSON.stringify(gasPrice)}`
    );
    return gasPrice.fast;
  }
}

/** Requires DAIMO_BUNDLER_RPC_URL. */
export function getBundlerClientFromEnv() {
  const rpcUrl = process.env.DAIMO_BUNDLER_RPC || "";
  assert(rpcUrl !== "", "DAIMO_BUNDLER_RPC env var missing");
  return new BundlerClient(rpcUrl);
}