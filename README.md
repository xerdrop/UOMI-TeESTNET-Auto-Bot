# UOMI Testnet Auto Bot 

An automation tool for  token trading, liquidity management, and balance tracking on the **UOMI Testnet**

## ✨ Features

- **Automated Trading** – Perform token swaps automatically with minimal input.  
- **Multi-Wallet Support** – Manage multiple wallets at once.  
- **Random or Manual Swaps** – Let the bot pick random pairs or choose your own.  
- **Liquidity Provision** – Automatically add liquidity to supported token pairs.  
- **Real-Time Balance Tracking** – Monitor all wallet balances in one place.  
- **Customizable Settings** – Adjust swap percentages, transaction delays, and more.  
- **Transaction Monitoring** – Get instant explorer links for every transaction.  

## 📥 Installation Guide

```bash
# 1. Clone the repository
git clone https://github.com/xerdrop/UOMI-TeESTNET-Auto-Bot.git

# 2. Go to the project folder
cd UOMI-TeESTNET-Auto-Bot

# 3. Install dependencies (Node.js & npm required)
npm install

# 4. Create a .env file in the root directory and add:
# Replace with your wallet private keys
echo "PRIVATE_KEYS_1=your_private_key_1
PRIVATE_KEYS_2=your_private_key_2
PRIVATE_KEYS_3=your_private_key_3" > .env

# 5. Run the bot
npm start
