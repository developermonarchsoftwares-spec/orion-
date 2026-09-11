import { HeroSection } from "@/components/landing/hero-section";
import { LogoBar } from "@/components/landing/logo-bar";
import { FeaturesSection } from "@/components/landing/features-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { PricingSection } from "@/components/landing/pricing-section";
import { FAQSection } from "@/components/landing/faq-section";
import { CTASection } from "@/components/landing/cta-section";

export default function MarketingPage() {
  return (
    <div className="flex min-h-screen flex-col w-full">
      <HeroSection />
      <LogoBar />
      <FeaturesSection />
      <HowItWorksSection />
      <PricingSection />
      <FAQSection />
      <CTASection />
    </div>
  );
}
