import Link from "next/link";
import { Zap, Home } from "lucide-react";
import "../app/globals.css";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-[#0a0b10] px-4 overflow-hidden text-center">
      {/* Background ambient elements */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 left-1/3 h-[400px] w-[400px] rounded-full bg-indigo-500/10 blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 h-[350px] w-[350px] rounded-full bg-violet-600/10 blur-[100px]" />
        
        {/* Subtle grid */}
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(rgba(99, 102, 241, 0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(99, 102, 241, 0.2) 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
            maskImage: "radial-gradient(ellipse 60% 60% at 50% 50%, black 10%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse 60% 60% at 50% 50%, black 10%, transparent 80%)",
          }}
        />
        
        {/* Horizontal data stream */}
        <div className="absolute left-0 top-[60%] h-[1px] w-full overflow-hidden opacity-30">
          <div className="h-full w-1/3 animate-[shimmer_4s_linear_infinite] bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
        </div>
      </div>

      <div className="relative z-10 flex flex-col items-center max-w-lg">
        {/* 404 Status Number with Glitch Style */}
        <h1 className="hero-gradient-text text-[8rem] font-bold tracking-tighter sm:text-[10rem] leading-none mb-4" style={{ filter: 'drop-shadow(0 0 40px rgba(99,102,241,0.3))' }}>
          404
        </h1>
        
        <h2 className="mb-6 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Lost in the Data <span className="text-indigo-400">Flow</span>
        </h2>
        
        <p className="mb-10 text-base leading-relaxed text-slate-400 sm:text-lg">
          The node or pipeline you are looking for doesn&apos;t exist, has been dropped from the schema, or drifted off into the chaos of the data lake.
        </p>
        
        <Link 
          href="/"
          className="group relative flex items-center justify-center gap-2.5 overflow-hidden rounded-xl px-8 py-3.5 text-sm font-bold uppercase tracking-widest text-white transition-all duration-300"
          style={{
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            boxShadow: "0 0 24px rgba(99,102,241,0.25), 0 4px 12px rgba(0,0,0,0.5)",
          }}
        >
          <div className="absolute inset-0 -translate-x-full animate-[shimmer_3s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <Home className="h-4 w-4 relative z-10" />
          <span className="relative z-10">Return to Safety</span>
        </Link>
        
        <div className="mt-12 flex items-center justify-center gap-2 text-xs font-mono text-slate-600">
          <Zap className="h-3 w-3 text-indigo-500/50" />
          <span>ERR_DAG_NODE_NOT_FOUND</span>
        </div>
      </div>
    </main>
  );
}
