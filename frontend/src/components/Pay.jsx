"use client";

import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import {
  CheckCircle2,
  Loader2,
  Lock,
  ArrowRight,
  CreditCard,
  Mail,
  Ticket,
} from "lucide-react";

const Pay = ({ cart }) => {
  const subtotal = cart.reduce((acc, item) => acc + item.price, 0);
  const serviceFee = subtotal * 0.05; // 5% Service Fee
  const total = subtotal + serviceFee;

  const { isPending, isError, mutate, data } = useMutation({
    mutationFn: async (cart) => {
      const startTime = Date.now();
      // Wait for the HTTP chain: Payment -> Tickets -> Email.
      const response = await axios.post(
        `${process.env.NEXT_PUBLIC_PAYMENT_URL || "http://localhost:8000"}/payment-service`,
        {
          cart,
          total,
        }
      );
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      return { ...response, duration };
    },
  });

  return (
    <div className="bg-white rounded-2xl shadow-xl shadow-zinc-200/50 overflow-hidden border border-zinc-100">
      {/* Header with Timer */}
      <div className="bg-zinc-900 text-white px-6 py-3 text-xs font-medium flex justify-between items-center">
        <span>Tickets reserved for:</span>
        <span className="font-mono text-yellow-400">09:59</span>
      </div>

      <div className="p-6 lg:p-8">
        <h2 className="text-xl font-bold mb-6 text-zinc-900">
          Booking Summary
        </h2>

        {/* Breakdown */}
        <div className="space-y-3 mb-8">
          <div className="flex justify-between text-zinc-500 text-sm">
            <span>Passes ({cart.length})</span>
            <span>€{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-zinc-500 text-sm">
            <span>Service Fee</span>
            <span>€{serviceFee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-zinc-500 text-sm">
            <span>Digital Delivery</span>
            <span className="text-green-600 font-medium">Free</span>
          </div>
          <div className="h-px bg-zinc-100 my-4" />
          <div className="flex justify-between items-center">
            <span className="font-bold text-zinc-900">Total</span>
            <span className="font-black text-3xl text-zinc-900">
              €{total.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Email Confirmation Note */}
        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mb-6 flex gap-3">
          <Mail className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div>
            <p className="text-xs text-blue-800 font-bold mb-0.5">
              E-Tickets via Email
            </p>
            <p className="text-[11px] text-blue-600 leading-tight">
              Your QR codes will be sent to{" "}
              <span className="font-bold">john.doe@example.com</span>{" "}
              immediately after payment.
            </p>
          </div>
        </div>

        {/* Payment Method */}
        <div className="flex items-center gap-3 mb-6 p-3 border border-zinc-200 rounded-lg opacity-80">
          <CreditCard className="w-4 h-4 text-zinc-400" />
          <span className="text-xs font-medium">Visa ending in 4242</span>
          <span className="ml-auto text-xs text-blue-600 cursor-pointer">
            Edit
          </span>
        </div>

        {/* Action Button */}
        <button
          onClick={() => mutate(cart)}
          disabled={isPending || data}
          className="w-full bg-indigo-600 text-white py-4 rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
        >
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Verifying
              availability...
            </>
          ) : data ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-green-200" /> Booked!
            </>
          ) : (
            <>
              Confirm & Pay <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        {/* Dynamic Status */}
        <div className="mt-4 text-center min-h-[24px]">
          {data && (
            <div className="flex flex-col items-center gap-1 animate-in fade-in slide-in-from-bottom-2">
              <span className="text-xs text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-100 flex items-center gap-1">
                <Ticket className="w-3 h-3" /> Tickets Generated in{" "}
                {data.duration}s
              </span>
              <span className="text-[10px] text-zinc-400">
                Check your email inbox
              </span>
            </div>
          )}
          {isError && (
            <span className="text-xs text-red-500 font-medium">
              Booking failed. Please try again.
            </span>
          )}
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-zinc-300">
          <Lock className="w-3 h-3" />
          <span className="text-[10px] uppercase tracking-widest font-bold">
            Official Ticket Vendor
          </span>
        </div>
      </div>
    </div>
  );
};

export default Pay;
