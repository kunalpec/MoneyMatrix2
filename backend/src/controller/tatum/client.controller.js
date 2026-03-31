import axios from "axios";


export const tatumClient = axios.create({
  baseURL: "https://api.tatum.io/v3",
  headers: {
    "x-api-key": process.env.TATUM_API_KEY_KUNAL
  },
  timeout: 15000
});

