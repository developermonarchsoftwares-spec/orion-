import { HeroSection } from "@/components/landing/hero-section";
import { LogoBar } from "@/components/landing/logo-bar";
import { SearchPreviewSection } from "@/components/landing/search-preview-section";
import { WhatOwnusGivesYouSection } from "@/components/landing/what-ownus-gives-you-section";
import { FreshDiscoverySection } from "@/components/landing/fresh-discovery-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { UseCasesSection } from "@/components/landing/use-cases-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { FAQSection } from "@/components/landing/faq-section";
import { CTASection } from "@/components/landing/cta-section";
import { Footer } from "@/components/layout/footer";
import { MarketingNav } from "@/components/layout/marketing-nav";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-black text-gray-900 dark:text-white">
      <MarketingNav />
      <main className="flex-1">
        {/* 1. Hero Section */}
        <HeroSection />
        
        {/* Logo Bar */}
        <LogoBar />

        {/* 2. Search / Discovery Preview */}
        <SearchPreviewSection />

        {/* 3. What Ownus Gives You */}
        <WhatOwnusGivesYouSection />

        {/* 4. Fresh Business Discovery */}
        <FreshDiscoverySection />

        {/* 5. How Ownus Works */}
        <HowItWorksSection />

        {/* 6. Built for Businesses That Need Leads */}
        <UseCasesSection />

        {/* Pricing & FAQ */}
        <PricingSection />
        <FAQSection />

        {/* 7. Final CTA */}
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
