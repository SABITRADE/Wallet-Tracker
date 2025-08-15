document.getElementById('addWallet').addEventListener('click', function() {
  const wallet = document.getElementById('walletInput').value.trim();
  const network = document.getElementById('networkSelect').value;

  if (wallet) {
    const walletList = document.getElementById('walletList');
    const walletItem = document.createElement('div');
    walletItem.textContent = `${network.toUpperCase()} Wallet: ${wallet}`;
    walletList.appendChild(walletItem);
    document.getElementById('walletInput').value = '';

    // TODO: Call API to get wallet balance & staking rewards
    // TODO: Check for airdrops
  }
});
