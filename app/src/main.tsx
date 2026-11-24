import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { UnsafeBurnerWalletAdapter } from "@solana/wallet-adapter-unsafe-burner";
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";
import App from "./App";
import { RPC_URL } from "./lib/program";

function Root() {
  // Phantom for real use. The "Burner" demo wallet lives in this browser only — local testing and recordings.
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new UnsafeBurnerWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
