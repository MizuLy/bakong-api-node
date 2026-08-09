require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const QRCode = require("qrcode");
const crypto = require("crypto");
const { BakongKHQR, khqrData, IndividualInfo } = require("bakong-khqr");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize KHQR
const khqr = new BakongKHQR();
const TRANSACTIONS = {};

// ------------------------------------------------------------------
// 1. Generate QR Code Endpoint
// ------------------------------------------------------------------
app.post("/api/generate-qr", async (req, res) => {
  try {
    const { amount, currency, description } = req.body;

    if (amount === undefined || amount === null || !currency) {
      return res
        .status(400)
        .json({ error: "Missing required fields: amount and currency" });
    }

    const currUpper = String(currency).toUpperCase();
    if (!["USD", "KHR"].includes(currUpper)) {
      return res.status(400).json({ error: "Currency must be USD or KHR" });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: "Amount must be greater than 0" });
    }

    if (currUpper === "KHR" && !Number.isInteger(amountNum)) {
      return res
        .status(400)
        .json({ error: "KHR amount must be a whole number" });
    }

    // Select official SDK Currency Enum
    const currencyEnum =
      currUpper === "USD" ? khqrData.currency.usd : khqrData.currency.khr;

    const billNumber = crypto.randomBytes(6).toString("hex");

    // 1. All transaction metadata (currency, amount, expiry) belongs inside optionalData
    const optionalData = {
      currency: currencyEnum,
      amount: amountNum,
      mobileNumber: "85516957000",
      storeLabel: "Shop Anh",
      terminalLabel: "WebQR",
      billNumber: billNumber,
      expirationTimestamp: Date.now() + 5 * 60 * 1000, // Required to trigger Dynamic QR (Tag 01 = 12)
      merchantCategoryCode: "5999",
    };

    // 2. IndividualInfo accepts EXACTLY 4 arguments:
    // Arg 1: Bakong Account ID (String)
    // Arg 2: Individual/Merchant Name (String)
    // Arg 3: City (String)
    // Arg 4: optionalData (Object containing currency, amount, expiry, etc.)
    const individualInfo = new IndividualInfo(
      process.env.BAKONG_ACCOUNT_ID,
      "Sea Sengly",
      "Phnom Penh",
      optionalData,
    );

    const khqrResponse = khqr.generateIndividual(individualInfo);

    if (khqrResponse.status.code !== 0) {
      throw new Error(khqrResponse.status.message || "Failed to generate KHQR");
    }

    const qrString = khqrResponse.data.qr;
    const md5 = khqrResponse.data.md5;

    console.log("--------------------------------------------------");
    console.log("GENERATED KHQR STRING:", qrString);
    console.log("--------------------------------------------------");

    // Convert payload to Base64 image
    const qrImage = await QRCode.toDataURL(qrString, { width: 350, margin: 2 });

    TRANSACTIONS[md5] = {
      amount: amountNum,
      currency: currUpper,
      description: description || "Payment",
      status: "UNPAID",
      bill_number: billNumber,
    };

    return res.json({
      success: true,
      qr_image: qrImage,
      qr_string: qrString,
      md5: md5,
      bill_number: billNumber,
      amount: amountNum,
      currency: currUpper,
    });
  } catch (error) {
    console.error("Generate QR Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ------------------------------------------------------------------
// 2. Check Payment Status Endpoint
// ------------------------------------------------------------------
app.get("/api/check-payment", async (req, res) => {
  try {
    const { md5 } = req.query;

    if (!md5 || !TRANSACTIONS[md5]) {
      return res.status(400).json({ error: "Invalid transaction ID" });
    }

    const transaction = TRANSACTIONS[md5];

    if (transaction.status !== "PAID" && process.env.BAKONG_TOKEN) {
      try {
        const apiResponse = await axios.post(
          "https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5",
          { md5: md5 },
          {
            headers: {
              Authorization: `Bearer ${process.env.BAKONG_TOKEN}`,
              "Content-Type": "application/json",
            },
          },
        );

        console.log("BAKONG CHECK RESPONSE:", apiResponse.data);

        if (apiResponse.data && apiResponse.data.responseCode === 0) {
          transaction.status = "PAID";
        }
      } catch (apiError) {
        console.error(
          "BAKONG CHECK ERROR:",
          apiError.response ? apiError.response.data : apiError.message,
        );
      }
    } else if (!process.env.BAKONG_TOKEN) {
      console.log("WARNING: BAKONG_TOKEN is missing in .env");
    }

    return res.json({
      status: transaction.status,
      transaction: {
        amount: transaction.amount,
        currency: transaction.currency,
        description: transaction.description,
        bill_number: transaction.bill_number,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// ------------------------------------------------------------------
// 3. Health Check
// ------------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", service: "Shop Anh Backend" });
});

// Start Server
const PORT = process.env.PORT || 6969;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
