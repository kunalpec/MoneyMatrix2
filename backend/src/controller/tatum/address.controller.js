import { Wallet } from "../../model/wallet.model.js";
import { User } from "../../model/user.model.js";

import { AsyncHandler } from "../../util/AsyncHandler.util.js";
import { ApiError } from "../../util/ApiError.util.js";
import { ApiResponse } from "../../util/ApiResponse.util.js";
import { tatumClient } from "./client.controller.js";
import { encrypt } from "../../util/EncryptDecrypt.util.js";


// get the wallet use this for address an save it 
export const UserWallet = AsyncHandler(async (req, res) => {
    // 1. Find User
    const user = await User.findById(req.user._id);
    const isAdmin=req.user.role==="admin"?true:false;
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    // 2. Check if wallet already exists
    const existingWallet = await Wallet.findOne({ user: user._id });
    if (existingWallet) {
        return res.status(200).json(
            new ApiResponse(200, { wallet: { address: existingWallet.address } }, "Wallet already exists")
        );
    }

    // 🟢 STEP 1: Generate Tron Wallet via Tatum
    const walletRes = await tatumClient.get("/tron/wallet"); // Usually a GET request for new wallet
    const { mnemonic, xpub } = walletRes.data;

    // 🟢 STEP 2: Generate address for this user (using index 0 for the first address)
    const addressRes = await tatumClient.get(`/tron/address/${xpub}/0`);
    const { address } = addressRes.data;

    // 🔐 Hash mnemonic for storage (Fixed logic)

    // 🟢 STEP 3: Save wallet in DB (FIXED OBJECT SYNTAX)
    const wallet = await Wallet.create({
        user: user._id,           // Added key name
        balance: 0,
        lockedBalance: 0,
        address: address,         // Added key name
        xpub: xpub,               // Added key name
        mnemonic: encrypt(mnemonic),
        index: 0,   
        isAdmin:isAdmin,              // Added key name
    });

    // 4. Update User Profile with the new address
    await User.findByIdAndUpdate(user._id, {
        tronAddress: address,
    });

    // 5. Return Response (Only send public info to frontend)
    return res.status(201).json(
        new ApiResponse(
            201, 
            { wallet: { address: wallet.address } }, 
            "Tron Wallet created successfully"
        )
    );
});
