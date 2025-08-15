/* ============== CONFIG (add your keys) ============== */
const CONFIG = {
  ETHERSCAN_API_KEY: "9MXK2CJK79RK8UF49ZGBYBJXDR61W7I5UJ",            // https://etherscan.io/myapikey
  BTC_PROVIDER: "blockchain",                              // "blockchain" | "blockstream"
  REFRESH_MS: 60_000
};

/* ============== STATE ============== */
let wallets = loadWallets();
let pricesUSD = { btc: 0, eth: 0, sol: 0 };
let refreshTimer = null;

/* ============== DOM REFS ============== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const tbody = $("#walletTbody");
const statusEl = $("#status");
const refreshTimerEl = $("#refreshTimer");

/* ============== UTILITIES ============== */
function saveWallets(){ localStorage.setItem("wallets_v1", JSON.stringify(wallets)); }
function loadWallets(){ try{ return JSON.parse(localStorage.getItem("wallets_v1")) || []; }catch{ return []; } }
const short = (addr, left = 6, right = 4) => addr.length > left + right + 3 ? `${addr.slice(0,left)}…${addr.slice(-right)}` : addr;
const fmt = (n, d=6) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const ts = () => new Date().toLocaleTimeString();

/* ============== PRICES (CoinGecko) ============== */
async function fetchUSDPrices(){
  try{
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd");
    const data = await res.json();
    pricesUSD = {
      btc: data.bitcoin?.usd ?? 0,
      eth: data.ethereum?.usd ?? 0,
      sol: data.solana?.usd ?? 0
    };
  }catch(e){ console.warn("Price fetch failed", e); }
}

/* ============== CHAIN FETCHERS ============== */
// Ethereum via Etherscan: returns ETH balance
async function getEthBalance(address){
  if(!CONFIG.ETHERSCAN_API_KEY) throw new Error("Missing ETHERSCAN_API_KEY");
  const url = `https://api.etherscan.io/api?module=account&action=balance&address=${address}&tag=latest&apikey=${CONFIG.ETHERSCAN_API_KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  if(j.status !== "1") throw new Error(j.message || "Etherscan error");
  const wei = BigInt(j.result);
  return Number(wei) / 1e18; // ETH
}

// Solana via Solscan: returns SOL balance (lamports -> SOL)
async function getSolBalance(address){
  // Public endpoint: https://public-api.solscan.io/account/<address>
  const url = `https://public-api.solscan.io/account/${address}`;
  const r = await fetch(url, { headers: { "accept": "application/json" }});
  if(!r.ok) throw new Error("Solscan error");
  const j = await r.json();
  // j.lamports is commonly present; fallback if missing
  const lamports = typeof j.lamports === "number" ? j.lamports : (j.data?.lamports ?? 0);
  return lamports / 1e9; // SOL
}

// Bitcoin via Blockchain.com or Blockstream
async function getBtcBalance(address){
  if(CONFIG.BTC_PROVIDER === "blockstream"){
    // Sum confirmed + unconfirmed
    const url = `https://blockstream.info/api/address/${address}`;
    const r = await fetch(url);
    const j = await r.json();
    const sat = (j.chain_stats?.funded_txo_sum - j.chain_stats?.spent_txo_sum) +
                (j.mempool_stats?.funded_txo_sum - j.mempool_stats?.spent_txo_sum);
    return sat / 1e8; // BTC
  }else{
    // Blockchain.com simple balance (satoshis)
    const url = `https://blockchain.info/q/addressbalance/${address}?confirmations=0`;
    const r = await fetch(url);
    if(!r.ok) throw new Error("Blockchain.com error");
    const sat = await r.text();
    return Number(sat) / 1e8; // BTC
  }
}

/* ============== RENDER ============== */
function render(){
  tbody.innerHTML = "";
  const rows = wallets.map((w, i) => {
    const tr = document.createElement("tr");
    tr.dataset.index = i;

    const label = document.createElement("td");
    label.textContent = w.label || "—";

    const addr = document.createElement("td");
    addr.className = "address";
    addr.textContent = short(w.address, 10, 8);
    addr.title = w.address;

    const chain = document.createElement("td");
    chain.innerHTML = `<span class="chain-pill"><span class="chain-dot"></span>${w.chain}</span>`;

    const bal = document.createElement("td");
    bal.className = "right glow";
    bal.innerHTML = `<span>…</span>`;

    const usd = document.createElement("td");
    usd.className = "right";
    usd.innerHTML = `<span class="usd">…</span>`;

    const updated = document.createElement("td");
    updated.className = "center";
    updated.textContent = "—";

    const actions = document.createElement("td");
    actions.className = "center row-actions";
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "Remove";
    del.addEventListener("click", () => removeWallet(i));
    actions.appendChild(del);

    tr.appendChild(label);
    tr.appendChild(addr);
    tr.appendChild(chain);
    tr.appendChild(bal);
    tr.appendChild(usd);
    tr.appendChild(updated);
    tr.appendChild(actions);

    // store refs for later updates
    tr._cells = { bal, usd, updated };
    return tr;
  });

  rows.forEach(tr => tbody.appendChild(tr));
}

function updateRowUI(tr, balance, usdVal){
  tr._cells.bal.innerHTML = `<span>${fmt(balance, 8)}</span>`;
  tr._cells.usd.innerHTML = `<span class="usd">$${fmt(usdVal, 2)}</span>`;
  tr._cells.updated.textContent = ts();
}

/* ============== DATA LOOP ============== */
async function refreshAll(){
  statusEl.textContent = "Refreshing…";
  await fetchUSDPrices();

  // fetch balances in parallel, then update UI
  const tasks = wallets.map(async (w, idx) => {
    const tr = tbody.querySelector(`tr[data-index="${idx}"]`);
    if(!tr) return;

    try{
      let balance = 0, usdVal = 0;
      if(w.chain === "ethereum"){
        balance = await getEthBalance(w.address);
        usdVal = balance * (pricesUSD.eth || 0);
      }else if(w.chain === "solana"){
        balance = await getSolBalance(w.address);
        usdVal = balance * (pricesUSD.sol || 0);
      }else if(w.chain === "bitcoin"){
        balance = await getBtcBalance(w.address);
        usdVal = balance * (pricesUSD.btc || 0);
      }
      updateRowUI(tr, balance, usdVal);
    }catch(e){
      console.warn(`${w.chain} fetch failed`, e);
      tr._cells.bal.innerHTML = `<span>error</span>`;
      tr._cells.usd.innerHTML = `<span class="usd">—</span>`;
      tr._cells.updated.textContent = "failed";
    }
  });

  await Promise.allSettled(tasks);
  statusEl.textContent = `Last refresh: ${ts()}`;
}

/* ============== WALLET CRUD ============== */
function addWallet(){
  const chain = $("#chainSelect").value;
  const address = $("#walletInput").value.trim();
  const label = $("#labelInput").value.trim();

  if(!address){ alert("Enter a wallet address"); return; }
  wallets.push({ chain, address, label });
  saveWallets();
  $("#walletInput").value = "";
  $("#labelInput").value = "";
  render();
  refreshAll();
}
function removeWallet(i){
  wallets.splice(i,1);
  saveWallets();
  render();
  refreshAll();
}
function clearAll(){
  if(!confirm("Remove all wallets?")) return;
  wallets = [];
  saveWallets();
  render();
}

/* ============== AUTORUN ============== */
function startTimer(){
  if(refreshTimer) clearInterval(refreshTimer);
  let left = CONFIG.REFRESH_MS/1000;
  refreshTimerEl.textContent = `${left}s`;
  refreshTimer = setInterval(() => {
    left--;
    if(left <= 0){
      refreshAll();
      left = CONFIG.REFRESH_MS/1000;
    }
    refreshTimerEl.textContent = `${left}s`;
  }, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  // events
  $("#addWallet").addEventListener("click", addWallet);
  $("#clearAll").addEventListener("click", clearAll);
  $("#refreshNow").addEventListener("click", refreshAll);

  // first render & load
  render();
  refreshAll();
  startTimer();
});
// ====== DeBank Staking & Airdrop Fetch ======
async function getDeFiData(wallet) {
    try {
        let url = `https://api.debank.com/user/complex_protocol_list?id=${wallet}&chain=eth`;
        let res = await fetch(url);
        let data = await res.json();

        if (data && data.data && data.data.length > 0) {
            let stakingList = data.data
                .filter(protocol => protocol.portfolio_item_list.some(item => item.name.toLowerCase().includes("stake")))
                .map(protocol => protocol.name)
                .join(", ");

            let farmingList = data.data
                .filter(protocol => protocol.portfolio_item_list.some(item => 
                    item.name.toLowerCase().includes("farm") || 
                    item.name.toLowerCase().includes("lp")
                ))
                .map(protocol => protocol.name)
                .join(", ");

            document.getElementById("staking").innerHTML = stakingList || "No active staking";
            document.getElementById("airdrops").innerHTML = farmingList || "No active farming/airdrops";
        } else {
            document.getElementById("staking").innerHTML = "No active staking";
            document.getElementById("airdrops").innerHTML = "No active farming/airdrops";
        }
    } catch (e) {
        console.error("DeBank fetch error:", e);
    }
                        }
wallets.forEach(wallet => {
    fetchBalances(wallet);
    getDeFiData(wallet);
});
