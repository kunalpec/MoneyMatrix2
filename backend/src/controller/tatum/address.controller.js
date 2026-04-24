import { Wallet } from "../../model/wallet.model.js";
import { User } from "../../model/user.model.js";
import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { tatumClient } from "./client.controller.js";
import { encrypt } from "../../util/EncryptDecrypt.util.js";
import { createDepositWebhookSubscription } from "../../service/tatumSubscription.service.js";

// ======== Create User Wallet (1) ========
export const UserWallet = AsyncHandler(async (req, res) => {
  // 1. Find user
  const user = await User.findById(req.user._id);
  const isAdmin = req.user.role === "admin" ? true : false;

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // 2. Check if wallet already exists
  const existingWallet = await Wallet.findOne({ user: user._id });

  if (existingWallet) {
    if (!existingWallet.depositSubscriptionId && existingWallet.address) {
      const depositSubscriptionId = await createDepositWebhookSubscription(
        existingWallet.address
      );

      existingWallet.depositSubscriptionId = depositSubscriptionId;
      await existingWallet.save();
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        { wallet: { address: existingWallet.address } },
        "Wallet already exists"
      )
    );  
  }

  // 3. Generate Tron wallet from Tatum
  const walletRes = await tatumClient.get("/tron/wallet");
  const { mnemonic, xpub } = walletRes.data;
  // 4. Generate first Tron address from xpub
  const addressRes = await tatumClient.get(`/tron/address/${xpub}/0`);
  const { address } = addressRes.data;
  const depositSubscriptionId = await createDepositWebhookSubscription(address);

  // 5. Save encrypted wallet data in database
  const wallet = await Wallet.create({
    user: user._id,
    address,
    depositSubscriptionId,
    xpub,
    mnemonic: encrypt(mnemonic),
    index: 0,
    isAdmin: isAdmin,
  });

  // 6. Save public Tron address on user profile
  await User.findByIdAndUpdate(user._id, {
    tronAddress: address,
  });

  // 7. Return only public wallet information
  return res.status(201).json(
    new ApiResponse(
      201,
      { wallet: { address: wallet.address } },
      "Tron Wallet created successfully"
    )
  );
});
