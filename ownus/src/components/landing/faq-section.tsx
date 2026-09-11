"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const faqs = [
  {
    question: "What is Orion?",
    answer: "Orion is an AI-powered business discovery platform that helps you find and analyze newly registered businesses before your competitors. We provide lead intelligence and contact information to help you convert opportunities into clients.",
  },
  {
    question: "How does the credit system work?",
    answer: "Credits are used to unlock full contact details and deep intelligence reports for businesses you're interested in. Searching, filtering, and viewing basic profiles are completely free. You only spend credits when you want the actionable data.",
  },
  {
    question: "What information do I get when I unlock a business?",
    answer: "When you unlock a business profile, you get access to full contact details (emails, phone numbers), key personnel information, tech stack analysis, digital footprint overview, and detailed AI-driven opportunity scores.",
  },
  {
    question: "How often is the business data updated?",
    answer: "Our system crawls state registries and other public data sources daily, ensuring you get access to the freshest business registrations as soon as they become available.",
  },
  {
    question: "Can I integrate Orion with my CRM?",
    answer: "Yes! Professional and Enterprise plans include API access and direct integrations with popular CRMs like Salesforce, HubSpot, and Pipedrive to seamlessly sync your unlocked leads.",
  },
  {
    question: "Is there a free trial?",
    answer: "Yes, we offer a 14-day free trial on all plans. You get full access to the platform and a set number of trial credits to test unlocking detailed business profiles. No credit card is required to start.",
  },
  {
    question: "How accurate is the Opportunity Score?",
    answer: "Our AI model analyzes dozens of signals including industry trends, digital presence strength, and funding indicators to generate the score. While no model is perfect, our users report a 3x higher conversion rate on leads with a high Opportunity Score.",
  },
  {
    question: "Can I export my leads?",
    answer: "Yes, all plans include CSV export functionality. You can easily select your unlocked leads and export them for use in your own spreadsheets, email marketing tools, or CRM systems.",
  },
];

export function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleAccordion = (index: number) => {
    if (openIndex === index) {
      setOpenIndex(null);
    } else {
      setOpenIndex(index);
    }
  };

  return (
    <section id="faq" className="py-20 sm:py-24 bg-white dark:bg-black">
      <div className="mx-auto max-w-3xl px-4">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-4xl">
            Frequently asked questions
          </h2>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div 
              key={index} 
              className="border border-gray-200 dark:border-neutral-800 rounded-lg overflow-hidden bg-white dark:bg-neutral-900 shadow-sm"
            >
              <button
                className="w-full px-6 py-4 text-left flex justify-between items-center focus:outline-none focus-visible:bg-gray-50 dark:focus-visible:bg-neutral-800 hover:bg-gray-50 dark:hover:bg-neutral-800/60 transition-colors"
                onClick={() => toggleAccordion(index)}
                aria-expanded={openIndex === index}
              >
                <span className="font-semibold text-gray-900 dark:text-white">{faq.question}</span>
                <ChevronDown 
                  className={cn(
                    "h-5 w-5 text-gray-500 dark:text-gray-400 transition-transform duration-200",
                    openIndex === index ? "rotate-180" : ""
                  )} 
                />
              </button>
              <div 
                className={cn(
                  "px-6 overflow-hidden transition-all duration-300 ease-in-out",
                  openIndex === index ? "max-h-96 py-4 border-t border-gray-100 dark:border-neutral-800" : "max-h-0 py-0"
                )}
              >
                <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                  {faq.answer}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
