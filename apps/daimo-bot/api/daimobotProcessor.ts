import {
  EAccount,
  assert,
  dollarsToAmount,
  encodeRequestId,
  formatDaimoLink,
  generateRequestId,
  getEAccountStr,
} from "@daimo/common";
import { NeynarAPIClient } from "@neynar/nodejs-sdk";
import * as dotenv from "dotenv";

import { BotResp } from "./botResponses";
import { trpcClient } from "./trpcClient";
import { SendCastOptions, TRPCClient, WebhookEvent } from "./types";

dotenv.config();

assert(!!process.env.DAIMO_NEYNAR_KEY, "DAIMO_NEYNAR_KEY is not defined");
const NEYNAR_CLIENT = new NeynarAPIClient(process.env.DAIMO_NEYNAR_KEY);

assert(
  !!process.env.DAIMOBOT_SIGNER_UUID,
  "DAIMOBOT_SIGNER_UUID is not defined"
);
const DAIMOBOT_SIGNER_UUID = process.env.DAIMOBOT_SIGNER_UUID;

assert(!!process.env.FARCASTER_ID, "FARCASTER_ID is not defined");
const FARCASTER_ID = process.env.FARCASTER_ID;

// Responds to Farcaster casts as @daimobot
// Makes it easy for people on Farcaster to pay each other onchain.
export class DaimobotProcessor {
  private text: string;
  private castId: string;
  private senderFid: number;
  private authorUsername: string;
  private parentAuthorFid: number | null;
  private trpcClient: TRPCClient;
  private neynarClient: NeynarAPIClient;

  constructor(
    event: WebhookEvent,
    trpc: TRPCClient = trpcClient,
    neynarClient: NeynarAPIClient = NEYNAR_CLIENT
  ) {
    const { data } = event;
    this.text = data.text;
    this.castId = data.hash;
    this.authorUsername = data.author.username;
    this.parentAuthorFid = data.parent_author.fid;
    this.senderFid = data.author.fid;

    this.trpcClient = trpc;
    this.neynarClient = neynarClient;
  }

  async process() {
    // Processes the incoming webhook event from Farcaster, extracting either a "request" or "pay" command,
    // and performs actions based on the command type.

    // 4 cases of Payment request:

    // "@daimobot request":
    // Case 1: Alice doesn't have FC linked ❌, requests $ from anyone (open-ended post)
    //      Action 1: Daimobot responds with a link to register with Farcaster. Alice registers, then Daimobot responds with a link to request $
    // Case 2: Alice has FC linked ✅, requests $ from anyone
    //      Action 2: Daimobot responses with link that requests $ from anyone to Alice's Daimo address

    // "@daimobot pay":
    // Case 3: Alice responds to Bobs post to pay him, Bob doesn't have FC linked ❌
    //     Action 3:  Daimobot responds with a link to register with Farcaster. Bob registers, then Daimobot responds with a link to request $
    // Case 4: Alice responds to Bobs post to pay him, Bob has FC linked ✅
    //     Action 4: Daimobot responds with link that requests $ from anyone to Bob's Daimo address

    if (this.senderFid === Number(FARCASTER_ID)) {
      console.log("Sender is self, skipping.");
      return;
    }

    const daimobotCommand = this._tryExtractCommand();
    if (!daimobotCommand) {
      console.log("Cast follows neither request nor pay format.");
      this.publishCastReply(BotResp.commandNotValid());
      return;
    }

    const { action, cleanedAmount } = daimobotCommand;
    switch (action) {
      case "request": {
        await this.handleRequestCommand(cleanedAmount);
        break;
      }
      case "pay": {
        await this.handlePayCommand(cleanedAmount);
        break;
      }
      default:
        console.log("Unknown command.");
    }
  }

  private async handleRequestCommand(cleanedAmount: number) {
    // See if sender has Farcaster linked
    console.log(
      `[DAIMOBOT REQUEST] lookupEthereumAccountByFid for FID: ${this.senderFid}`
    );
    const senderEthAccount =
      await this.trpcClient.lookupEthereumAccountByFid.query({
        fid: this.senderFid,
      });
    if (!senderEthAccount) {
      console.log(
        "Sender not registered with Farcaster. Sending a response cast."
      );
      // TODO: deeplink into the connect farcaster flow
      this.publishCastReply(BotResp.connectFarcasterToContinue());
      return;
    }

    const daimoShareUrl = await this.createRequestLink(
      cleanedAmount,
      senderEthAccount
    );
    this.publishCastReply(
      BotResp.request(cleanedAmount, this.authorUsername, daimoShareUrl),
      { embeds: [{ url: daimoShareUrl }] }
    );
  }

  private async handlePayCommand(cleanedAmount: number) {
    // See if prospective recipient has Farcaster linked
    if (!this.parentAuthorFid) {
      console.warn(
        "No parent author FID found, thus no one to prospectively pay."
      );
      this.publishCastReply(BotResp.mustReplyToPayOrRequest());
      return;
    }
    const recipientEthAccount =
      await this.trpcClient.lookupEthereumAccountByFid.query({
        fid: this.parentAuthorFid,
      });
    const recipientUsername = await this.getFcUsernameByFid(
      this.parentAuthorFid
    );
    if (!recipientEthAccount) {
      console.log(
        "Recipient not registered with Farcaster. Sending a response cast."
      );
      this.publishCastReply(
        BotResp.noDaimoOrEthAccountFound(recipientUsername)
      );
      return;
    }
    const daimoShareUrl = await this.createRequestLink(
      cleanedAmount,
      recipientEthAccount
    );

    this.publishCastReply(
      BotResp.request(cleanedAmount, recipientUsername, daimoShareUrl),
      {
        embeds: [{ url: daimoShareUrl }],
      }
    );
  }

  _tryExtractCommand(): {
    action: string;
    cleanedAmount: number;
  } | null {
    const match = this.text?.match(/exchange \$?([0-9]*\.?[0-9]{1,2})/);
    console.log(`[ARCHBOT] checking: ${JSON.stringify(match)}`);
    if (match) {
      const cleanedAmount = parseFloat(parseFloat(match[1]).toFixed(2));
      return {
        action: "request",
        cleanedAmount,
      };
    }
    return null;
  }

  private async createRequestLink(amount: number, requestRecipient: EAccount) {
    const idString = encodeRequestId(generateRequestId());
    const recipient = requestRecipient.addr;

    const params = {
      recipient,
      idString,
      amount: dollarsToAmount(amount).toString(),
    };
    console.log(
      `[ARCHBOT] createRequestSponsored with params: ${JSON.stringify(params)}`
    );
    const txHash = await this.trpcClient.createRequestSponsored.mutate(params);
    console.log(`[ARCHBOT REQUEST] txHash ${txHash}`);
    const recipient2 = getEAccountStr(requestRecipient);
    const daimoShareUrl = `https://archframe.onrender.com/welcome/${idString}/${recipient2}/${amount}`;
    // const daimoShareUrl = formatDaimoLink({
    //   type: "requestv2",
    //   id: idString,
    //   recipient: getEAccountStr(requestRecipient),
    //   dollars: `${amount}`,
    // });
    console.log(`[ARCHBOT REQUEST] url ${daimoShareUrl}`);
    return daimoShareUrl;
  }

  private async publishCastReply(text: string, opts: SendCastOptions = {}) {
    if (["production", "test"].includes(process.env.BOT_ENV!)) {
      await this.neynarClient
        .publishCast(DAIMOBOT_SIGNER_UUID, text, {
          ...opts,
          replyTo: this.castId,
        })
        .then((data) =>
          console.log("Published Cast:", JSON.stringify(data, null, 2))
        )
        .catch((err: any) => console.error(err));
    } else {
      console.log(
        `[ARCHBOT] MOCK published cast: ${JSON.stringify(
          { text, opts },
          null,
          2
        )}`
      );
    }
  }

  private async getFcUsernameByFid(fid: number) {
    const profile = await this.neynarClient.fetchBulkUsers([fid]);
    const len = profile.users.length;
    assert(len === 1, `Expected exactly 1 user to be returned, got ${len}`);
    return profile.users[0].username;
  }
}
