import { CTASection } from "@/components/landing/cta-section";
import { FAQSection } from "@/components/landing/faq-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { HeroSection } from "@/components/landing/hero-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { LogoBar } from "@/components/landing/logo-bar";
import { PricingSection } from "@/components/landing/pricing-section";
import { Footer } from "@/components/layout/footer";
import { MarketingNav } from "@/components/layout/marketing-nav";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-black text-gray-900 dark:text-white">
      <MarketingNav />
      <main className="flex-1">
        <HeroSection />
        <LogoBar />
        <FeaturesSection />
        <HowItWorksSection />
        <PricingSection />
        <FAQSection />
        <CTASection />
      </main>
      <Footer />
    </div>
  );
}
