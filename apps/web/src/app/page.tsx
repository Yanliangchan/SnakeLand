"use client";

import { AnimatePresence, motion } from "framer-motion";
import { FullScreenLoader } from "@/components/FullScreenLoader";
import { Lobby } from "@/components/lobby/Lobby";
import { Welcome } from "@/components/lobby/Welcome";
import { fade } from "@/lib/motion";
import { useSession } from "@/providers/session";

export default function HomePage() {
  const { status } = useSession();
  return (
    <AnimatePresence mode="wait">
      <motion.div key={status} {...fade}>
        {status === "loading" ? <FullScreenLoader /> : status === "ready" ? <Lobby /> : <Welcome />}
      </motion.div>
    </AnimatePresence>
  );
}
