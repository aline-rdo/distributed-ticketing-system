import { X, MapPin } from "lucide-react";
import Image from "next/image";

import Pay from "@/components/Pay";

const Page = () => {
  // Updated Data: Tomorrowland 3-Day Passes
  const tickets = [
    {
      id: 1,
      name: "Magical Friday Pass",
      price: 125.0,
      image: "/day1.jpeg",
      date: "Friday, July 19",
      category: "General Access",
      location: "Boom, Belgium",
      description:
        "Full access to The Reflection of Love. featuring Armin van Buuren, Hardwell, and more.",
    },
    {
      id: 2,
      name: "Incredible Saturday Pass",
      price: 135.0,
      image: "/day2.jpeg",
      date: "Saturday, July 20",
      category: "General Access",
      location: "Boom, Belgium",
      description:
        "Experience the madness. Featuring Martin Garrix, Alesso, and Tiësto on the mainstage.",
    },
    {
      id: 3,
      name: "Glorious Sunday Pass",
      price: 135.0,
      image: "/day3.jpeg",
      date: "Sunday, July 21",
      category: "Closing Ceremony",
      location: "Boom, Belgium",
      description:
        "The final chapter. Featuring David Guetta and the grand closing ceremony fireworks.",
    },
  ];

  return (
    <div className="min-h-screen pb-20">
      <div className="mb-10">
        <h1 className="text-3xl font-black tracking-tight text-zinc-900 uppercase">
          Review Your Booking
        </h1>
        <p className="text-zinc-500 mt-2">
          Please review your selected passes before proceeding to payment.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        {/* Left Column: Tickets List */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {tickets.map((item) => (
            <div
              key={item.id}
              className="group flex flex-col sm:flex-row gap-0 sm:gap-6 rounded-2xl border border-zinc-200 bg-white overflow-hidden hover:shadow-lg hover:shadow-zinc-200/50 transition-all duration-300"
            >
              {/* Event Image / Date Box */}
              <div className="relative w-full sm:w-48 aspect-video sm:aspect-auto bg-zinc-900 flex-shrink-0 flex flex-col items-center justify-center text-white p-6">
                {/* Background Image Overlay */}
                <Image
                  src={item.image}
                  alt={item.name}
                  fill
                  className="object-cover opacity-60 group-hover:scale-105 transition-transform duration-700"
                />
                <div className="relative z-10 flex flex-col items-center text-center">
                  <span className="text-xs font-bold uppercase tracking-widest opacity-80 mb-1">
                    July
                  </span>
                  <span className="text-3xl font-black">
                    {item.date.split(" ")[2]}
                  </span>{" "}
                  {/* Extracts '19', '20' etc */}
                  <span className="text-xs font-medium opacity-80 mt-1">
                    {item.date.split(",")[0]}
                  </span>
                </div>
              </div>

              {/* Ticket Info */}
              <div className="flex-1 flex flex-col justify-between p-6 sm:pl-0">
                <div>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-bold text-zinc-900">
                      {item.name}
                    </h3>
                    <p className="text-lg font-bold text-zinc-900">
                      €{item.price.toFixed(2)}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 text-xs font-medium text-zinc-500 mb-3 uppercase tracking-wide">
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {item.location}
                    </span>
                    <span className="w-1 h-1 bg-zinc-300 rounded-full"></span>
                    <span>{item.category}</span>
                  </div>

                  <p className="text-sm text-zinc-400 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="flex items-center justify-end mt-4">
                  <button className="text-xs font-semibold text-zinc-400 hover:text-red-500 flex items-center gap-1 transition-colors px-3 py-1 hover:bg-red-50 rounded-full">
                    <X className="w-3 h-3" /> Remove Pass
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Right Column: Checkout Summary */}
        <div className="lg:col-span-4 lg:sticky lg:top-28">
          <Pay cart={tickets} />
        </div>
      </div>
    </div>
  );
};

export default Page;
