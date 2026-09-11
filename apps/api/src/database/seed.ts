import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { Client as TypesenseClient } from 'typesense';
import * as schema from './schema';
import { eq } from 'drizzle-orm';
import { BUSINESSES_COLLECTION_SCHEMA, BUSINESSES_SEARCH_COLLECTION } from '../modules/search/search.constants';

dotenv.config();

const sampleBusinesses = [
  {
    name: 'Apex Industrial Robotics',
    legalName: 'Apex Industrial Robotics Pvt Ltd',
    slug: 'apex-industrial-robotics',
    industryCode: 'MFG',
    businessType: 'PRIVATE_LIMITED' as const,
    msmeCategory: 'MEDIUM' as const,
    opportunityTier: 'HIGH' as const,
    employeeCountRange: '51-200',
    annualRevenueRange: '₹25 Cr - ₹100 Cr',
    foundingYear: 2019,
    description: 'Pioneering intelligent automation and robotic arm integrations for high-precision manufacturing and automotive assembly lines.',
    orionScore: 94,
    location: {
      addressLine1: 'Plot 42, MIDC Industrial Area, Phase II',
      city: 'Pune',
      district: 'Pune',
      state: 'Maharashtra',
      pincode: '411018',
    },
    contact: {
      fullName: 'Vikramaditya Singhania',
      title: 'Managing Director & CEO',
      department: 'Executive Leadership',
      email: 'vikram@apexrobotics.in',
      phone: '+91 98220 19283',
    },
    website: 'https://apexrobotics.in',
    technologies: ['ROS 2', 'C++', 'Python', 'Siemens PLC', 'Azure IoT'],
  },
  {
    name: 'CloudScale Telemetry Systems',
    legalName: 'CloudScale Telemetry Systems Inc',
    slug: 'cloudscale-telemetry-systems',
    industryCode: 'TECH',
    businessType: 'PRIVATE_LIMITED' as const,
    msmeCategory: 'SMALL' as const,
    opportunityTier: 'HIGH' as const,
    employeeCountRange: '21-50',
    annualRevenueRange: '₹5 Cr - ₹25 Cr',
    foundingYear: 2021,
    description: 'Enterprise observability and distributed tracing infrastructure platform engineered for microservices and cloud-native Kubernetes workloads.',
    orionScore: 91,
    location: {
      addressLine1: 'Tech Hub 3, 5th Floor, Outer Ring Road',
      city: 'Bengaluru',
      district: 'Bengaluru Urban',
      state: 'Karnataka',
      pincode: '560103',
    },
    contact: {
      fullName: 'Aarav Nambiar',
      title: 'Chief Technology Officer',
      department: 'Engineering',
      email: 'aarav@cloudscale.io',
      phone: '+91 99800 45210',
    },
    website: 'https://cloudscale.io',
    technologies: ['Go', 'Rust', 'Kubernetes', 'Prometheus', 'ClickHouse', 'AWS'],
  },
  {
    name: 'BioGenix Life Therapeutics',
    legalName: 'BioGenix Life Therapeutics LLP',
    slug: 'biogenix-life-therapeutics',
    industryCode: 'HEALTH',
    businessType: 'LLP' as const,
    msmeCategory: 'MICRO' as const,
    opportunityTier: 'HIGH' as const,
    employeeCountRange: '11-20',
    annualRevenueRange: '₹1 Cr - ₹5 Cr',
    foundingYear: 2023,
    description: 'Specialized clinical formulation laboratory focused on targeted peptide therapy and biological active pharmaceutical ingredients (API).',
    orionScore: 89,
    location: {
      addressLine1: 'Genome Valley Biotech Park, Tower B',
      city: 'Hyderabad',
      district: 'Hyderabad',
      state: 'Telangana',
      pincode: '500078',
    },
    contact: {
      fullName: 'Dr. Sunita Deshmukh',
      title: 'Director of Research',
      department: 'R&D',
      email: 'dr.sunita@biogenixlife.com',
      phone: '+91 97010 33412',
    },
    website: null,
    technologies: [],
  },
  {
    name: 'FinFlow Merchant Settlements',
    legalName: 'FinFlow Merchant Settlements Pvt Ltd',
    slug: 'finflow-merchant-settlements',
    industryCode: 'FIN',
    businessType: 'PRIVATE_LIMITED' as const,
    msmeCategory: 'SMALL' as const,
    opportunityTier: 'MEDIUM' as const,
    employeeCountRange: '21-50',
    annualRevenueRange: '₹10 Cr - ₹50 Cr',
    foundingYear: 2020,
    description: 'Next-generation omni-channel payment gateway and instant liquidity reconciliation solution for retail merchant chains across India.',
    orionScore: 86,
    location: {
      addressLine1: 'BKC Financial Center, Level 8, G Block',
      city: 'Mumbai',
      district: 'Mumbai Suburban',
      state: 'Maharashtra',
      pincode: '400051',
    },
    contact: {
      fullName: 'Rajesh K. Mehta',
      title: 'Head of Merchant Partnerships',
      department: 'Commercial',
      email: 'rajesh.mehta@finflow.co.in',
      phone: '+91 98190 77621',
    },
    website: 'https://finflow.co.in',
    technologies: ['Node.js', 'PostgreSQL', 'Redis', 'Kafka', 'React', 'Docker'],
  },
  {
    name: 'OmniPack Global Logistics',
    legalName: 'OmniPack Logistics & Warehousing Pvt Ltd',
    slug: 'omnipack-global-logistics',
    industryCode: 'LOG',
    businessType: 'PRIVATE_LIMITED' as const,
    msmeCategory: 'MEDIUM' as const,
    opportunityTier: 'HIGH' as const,
    employeeCountRange: '100-250',
    annualRevenueRange: '₹50 Cr - ₹200 Cr',
    foundingYear: 2018,
    description: 'Cold-chain storage network and temperature-monitored inter-state express freight transport catering to pharmaceuticals and perishables.',
    orionScore: 92,
    location: {
      addressLine1: 'NH-48 Logistics Corridor, Sector 18',
      city: 'Gurugram',
      district: 'Gurugram',
      state: 'Haryana',
      pincode: '122015',
    },
    contact: {
      fullName: 'Harpreet Singh Bindra',
      title: 'VP Operations',
      department: 'Logistics Operations',
      email: 'h.bindra@omnipacklogistics.com',
      phone: '+91 98111 65432',
    },
    website: 'https://omnipacklogistics.com',
    technologies: ['SAP S/4HANA', 'IoT GPS Fleet', 'Python', 'Tableau'],
  },
  {
    name: 'Zenith Solar Structures',
    legalName: 'Zenith Solar Fabrication LLP',
    slug: 'zenith-solar-structures',
    industryCode: 'MFG',
    businessType: 'LLP' as const,
    msmeCategory: 'SMALL' as const,
    opportunityTier: 'HIGH' as const,
    employeeCountRange: '11-50',
    annualRevenueRange: '₹5 Cr - ₹20 Cr',
    foundingYear: 2022,
    description: 'Galvanized steel mounting structures and single-axis tracker frames engineered for commercial rooftop and utility solar installations.',
    orionScore: 88,
    location: {
      addressLine1: 'GIDC Industrial Estate, Phase 3',
      city: 'Ahmedabad',
      district: 'Ahmedabad',
      state: 'Gujarat',
      pincode: '382445',
    },
    contact: {
      fullName: 'Pranav K. Patel',
      title: 'Managing Partner',
      department: 'Executive Management',
      email: 'pranav@zenithsolarstructures.com',
      phone: '+91 98250 88910',
    },
    website: null,
    technologies: [],
  },
  {
    name: 'Horizon Retail Hypermarket',
    legalName: 'Horizon Consumer Retail Network Pvt Ltd',
    slug: 'horizon-retail-hypermarket',
    industryCode: 'RETAIL',
    businessType: 'PRIVATE_LIMITED' as const,
    msmeCategory: 'MEDIUM' as const,
    opportunityTier: 'MEDIUM' as const,
    employeeCountRange: '51-200',
    annualRevenueRange: '₹25 Cr - ₹100 Cr',
    foundingYear: 2017,
    description: 'Regional grocery supermarket chain operating 14 modern departmental outlets across South India with direct farm-to-shelf procurement.',
    orionScore: 83,
    location: {
      addressLine1: 'Anna Salai Commercial Complex, T. Nagar',
      city: 'Chennai',
      district: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600017',
    },
    contact: {
      fullName: 'Karthik Ramanathan',
      title: 'Director of Procurement',
      department: 'Procurement & Supply',
      email: 'karthik.r@horizonretail.in',
      phone: '+91 94440 12890',
    },
    website: 'https://horizonretail.in',
    technologies: ['Shopify Plus', 'Magento', 'Tally Prime', 'MySQL'],
  },
  {
    name: 'Sterling Infra Concretes',
    legalName: 'Sterling ReadyMix Infra Concretes Pvt Ltd',
    slug: 'sterling-infra-concretes',
    industryCode: 'RE',
    businessType: 'PRIVATE_LIMITED' as const,
    msmeCategory: 'MEDIUM' as const,
    opportunityTier: 'HIGH' as const,
    employeeCountRange: '51-150',
    annualRevenueRange: '₹20 Cr - ₹80 Cr',
    foundingYear: 2020,
    description: 'High-grade ready-mix concrete batching plants and transit mixer fleet supporting smart city metro, expressway, and flyover civil works.',
    orionScore: 90,
    location: {
      addressLine1: 'Noida Expressway Industrial Sector 135',
      city: 'Noida',
      district: 'Gautam Buddha Nagar',
      state: 'Uttar Pradesh',
      pincode: '201304',
    },
    contact: {
      fullName: 'Deepak Chaudhary',
      title: 'Chief Operating Officer',
      department: 'Operations',
      email: 'deepak.c@sterlinginfra.in',
      phone: '+91 98180 54321',
    },
    website: null,
    technologies: [],
  },
  {
    name: 'Vanguard Corporate Legal Advisors',
    legalName: 'Vanguard Legal & Compliance Advisors LLP',
    slug: 'vanguard-corporate-legal-advisors',
    industryCode: 'PROF',
    businessType: 'PARTNERSHIP' as const,
    msmeCategory: 'SMALL' as const,
    opportunityTier: 'MEDIUM' as const,
    employeeCountRange: '11-30',
    annualRevenueRange: '₹2 Cr - ₹10 Cr',
    foundingYear: 2016,
    description: 'Corporate law advisory firm specializing in cross-border M&A transactions, FDI structuring, Intellectual Property filings, and GST dispute representation.',
    orionScore: 85,
    location: {
      addressLine1: 'Barakhamba Road, Connaught Place',
      city: 'New Delhi',
      district: 'New Delhi',
      state: 'Delhi',
      pincode: '110001',
    },
    contact: {
      fullName: 'Adv. Meenakshi Sundaram',
      title: 'Senior Managing Partner',
      department: 'Corporate Practice',
      email: 'meenakshi@vanguardlegal.in',
      phone: '+91 98100 99887',
    },
    website: 'https://vanguardlegal.in',
    technologies: ['WordPress', 'Google Workspace', 'Clio'],
  },
  {
    name: 'QuantumEdu Digital Academy',
    legalName: 'QuantumEdu Learning Technologies Pvt Ltd',
    slug: 'quantumedu-digital-academy',
    industryCode: 'TECH',
    businessType: 'PRIVATE_LIMITED' as const,
    msmeCategory: 'MICRO' as const,
    opportunityTier: 'HIGH' as const,
    employeeCountRange: '5-15',
    annualRevenueRange: '₹50L - ₹2 Cr',
    foundingYear: 2024,
    description: 'Interactive STEM and AI-literacy learning modules and simulation software for secondary schools and university engineering colleges.',
    orionScore: 93,
    location: {
      addressLine1: 'Kakkanad Infopark Phase 2',
      city: 'Kochi',
      district: 'Ernakulam',
      state: 'Kerala',
      pincode: '682042',
    },
    contact: {
      fullName: 'Ananya Thomas',
      title: 'Founder & Head of Curriculum',
      department: 'Product & Pedagogy',
      email: 'ananya@quantumedu.in',
      phone: '+91 98470 56789',
    },
    website: null,
    technologies: [],
  },
];

async function seedDatabase() {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/orion_db';
  console.log('Connecting to database for seeding...');

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
  });

  const db = drizzle(pool, { schema });

  try {
    console.log('Seeding initial system administrator...');
    const adminEmail = 'admin@orion.ai';
    const existingAdmin = await db.query.users.findFirst({
      where: eq(schema.users.email, adminEmail),
    });

    if (!existingAdmin) {
      const passwordHash = await bcrypt.hash('OrionAdmin@2026!', 12);
      const [adminUser] = await db
        .insert(schema.users)
        .values({
          email: adminEmail,
          passwordHash,
          firstName: 'System',
          lastName: 'Administrator',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          isEmailVerified: true,
          metadata: { initializedBy: 'system-seeder' },
        })
        .returning();

      // Create initial admin wallet with 10,000 credits
      await db.insert(schema.userWallets).values({
        userId: adminUser.id,
        dailyCredits: 5,
        purchasedCredits: 10000,
        balance: 10005,
        lastDailyCreditDate: new Date().toISOString().slice(0, 10),
        lifetimePurchased: 10000,
        lifetimeUsed: 0,
      });

      console.log('✓ Created super admin user: admin@orion.ai');
    } else {
      console.log('ℹ Super admin already exists.');
      // Ensure wallet is initialized with daily/purchased
      const adminWallet = await db.query.userWallets.findFirst({
        where: eq(schema.userWallets.userId, existingAdmin.id),
      });
      if (adminWallet && (!adminWallet.dailyCredits || adminWallet.dailyCredits === 0)) {
        await db.update(schema.userWallets).set({
          dailyCredits: 5,
          purchasedCredits: adminWallet.balance || 10000,
          balance: (adminWallet.balance || 10000) + 5,
          lastDailyCreditDate: new Date().toISOString().slice(0, 10),
        }).where(eq(schema.userWallets.id, adminWallet.id));
      }
    }

    // Seed Demo User
    const demoEmail = 'demo@orion.ai';
    const existingDemo = await db.query.users.findFirst({
      where: eq(schema.users.email, demoEmail),
    });

    if (!existingDemo) {
      const passwordHash = await bcrypt.hash('OrionDemo@2026!', 12);
      const [demoUser] = await db
        .insert(schema.users)
        .values({
          email: demoEmail,
          passwordHash,
          firstName: 'Alex',
          lastName: 'Thompson',
          organizationName: 'Acme Commercial Corp',
          phoneNumber: '+91 98450 12345',
          role: 'USER',
          status: 'ACTIVE',
          isEmailVerified: true,
        })
        .returning();

      await db.insert(schema.userWallets).values({
        userId: demoUser.id,
        dailyCredits: 5,
        purchasedCredits: 250,
        balance: 255,
        lastDailyCreditDate: new Date().toISOString().slice(0, 10),
        lifetimePurchased: 250,
        lifetimeUsed: 0,
      });
      console.log('✓ Created demo customer: demo@orion.ai (Password: OrionDemo@2026!) with 255 credits');
    } else {
      const demoWallet = await db.query.userWallets.findFirst({
        where: eq(schema.userWallets.userId, existingDemo.id),
      });
      if (demoWallet && (!demoWallet.dailyCredits || demoWallet.dailyCredits === 0)) {
        await db.update(schema.userWallets).set({
          dailyCredits: 5,
          purchasedCredits: demoWallet.balance || 250,
          balance: (demoWallet.balance || 250) + 5,
          lastDailyCreditDate: new Date().toISOString().slice(0, 10),
        }).where(eq(schema.userWallets.id, demoWallet.id));
      }
    }

    console.log('Seeding pricing settings and credit packages...');
    const defaultSettings = [
      {
        key: 'DAILY_FREE_CREDITS',
        value: { amount: 5, description: 'Daily free credits allocated to each active user' },
        description: 'Daily free credits amount',
      },
      {
        key: 'ANNUAL_DISCOUNT_PERCENTAGE',
        value: { percentage: 20, description: 'Discount applied to annual package purchases' },
        description: 'Annual billing discount percentage',
      },
      {
        key: 'DEFAULT_CURRENCY',
        value: { currency: 'INR', symbol: '₹' },
        description: 'Default platform billing currency',
      },
    ];

    for (const setting of defaultSettings) {
      const existing = await db.query.pricingSettings.findFirst({
        where: eq(schema.pricingSettings.key, setting.key),
      });
      if (!existing) {
        await db.insert(schema.pricingSettings).values(setting);
      }
    }
    console.log('✓ Pricing settings verified/seeded.');

    const defaultPackages = [
      {
        slug: 'free',
        name: 'Free Plan',
        description: 'Standard access for early prospecting and exploring verified business intelligence.',
        priceInr: 0,
        credits: 5,
        userLimit: 1,
        billingType: 'DAILY_FREE',
        popular: false,
        badgeText: '5 Daily Credits',
        features: [
          '5 Daily Verified Leads',
          'Search & Discovery Engine',
          'Basic Contact Details',
          'Daily rollover at 11:59 PM',
          'Community Support',
        ],
        isActive: true,
        sortOrder: 1,
      },
      {
        slug: 'starter',
        name: 'Starter Pack',
        description: 'Ideal for individual founders, freelancers, and sales reps building focused pipelines.',
        priceInr: 99,
        credits: 100,
        userLimit: 1,
        billingType: 'ONE_TIME',
        popular: false,
        badgeText: 'Save 20% with Annual Billing',
        features: [
          '100 Lifetime Lead Credits',
          'Credits Never Expire',
          'Direct Mobile & Email Unlocks',
          'CSV / Spreadsheet Export',
          'Single User License',
          'Standard Support',
        ],
        isActive: true,
        sortOrder: 2,
      },
      {
        slug: 'growth',
        name: 'Growth Pack',
        description: 'Best for growing sales teams and agencies looking for rapid pipeline scale.',
        priceInr: 299,
        credits: 350,
        userLimit: 1,
        billingType: 'ONE_TIME',
        popular: true,
        badgeText: 'Most Popular • Save 20% Annual',
        features: [
          '350 Lifetime Lead Credits',
          'Credits Never Expire',
          'Direct Decision Maker Contacts',
          'Full Export & Filter Capabilities',
          'Single User License',
          'Priority Email Support',
        ],
        isActive: true,
        sortOrder: 3,
      },
      {
        slug: 'agency',
        name: 'Agency Pack',
        description: 'High-volume lead intelligence for outreach agencies and enterprise outbound teams.',
        priceInr: 999,
        credits: 1500,
        userLimit: 1,
        billingType: 'ONE_TIME',
        popular: false,
        badgeText: 'Best Value • Save 20% Annual',
        features: [
          '1,500 Lifetime Lead Credits',
          'Credits Never Expire',
          'Full Executive & CXO Contacts',
          'Bulk Export Engine',
          'Single User License',
          'Priority VIP Support',
        ],
        isActive: true,
        sortOrder: 4,
      },
      {
        slug: 'enterprise',
        name: 'Enterprise Plan',
        description: 'Custom high-volume intelligence, dedicated infrastructure, and team workspace management.',
        priceInr: null,
        credits: 0,
        userLimit: null,
        billingType: 'CUSTOM',
        popular: false,
        badgeText: 'Custom Solution',
        features: [
          'Custom High-Volume Credit Allocation',
          'Unlimited Team Users & RBAC',
          'Team Workspace Collaboration',
          'Bulk Export Engine',
          'Dedicated API Access',
          '24x7 Priority Account Manager',
        ],
        isActive: true,
        sortOrder: 5,
      },
    ];

    for (const pkg of defaultPackages) {
      const existing = await db.query.creditPackages.findFirst({
        where: eq(schema.creditPackages.slug, pkg.slug),
      });
      if (!existing) {
        await db.insert(schema.creditPackages).values(pkg);
      } else {
        await db.update(schema.creditPackages).set(pkg).where(eq(schema.creditPackages.slug, pkg.slug));
      }
    }
    console.log('✓ Credit packages verified/seeded.');

    console.log('Seeding baseline industry taxonomies...');
    const baselineIndustries = [
      { code: 'TECH', name: 'Information Technology & SaaS', slug: 'information-technology-saas' },
      { code: 'HEALTH', name: 'Healthcare & Life Sciences', slug: 'healthcare-life-sciences' },
      { code: 'FIN', name: 'Financial Services & Fintech', slug: 'financial-services-fintech' },
      { code: 'MFG', name: 'Manufacturing & Industrial', slug: 'manufacturing-industrial' },
      { code: 'RETAIL', name: 'Retail & E-commerce', slug: 'retail-ecommerce' },
      { code: 'RE', name: 'Real Estate & Construction', slug: 'real-estate-construction' },
      { code: 'PROF', name: 'Professional & Legal Services', slug: 'professional-legal-services' },
      { code: 'LOG', name: 'Logistics & Supply Chain', slug: 'logistics-supply-chain' },
    ];

    const industryMap: Record<string, string> = {};

    for (const ind of baselineIndustries) {
      let existing = await db.query.industries.findFirst({
        where: eq(schema.industries.code, ind.code),
      });

      if (!existing) {
        const [inserted] = await db.insert(schema.industries).values(ind).returning();
        existing = inserted;
      }
      if (existing) {
        industryMap[ind.code] = existing.id;
      }
    }
    console.log('✓ Baseline industries verified/seeded.');

    console.log('Seeding baseline sample business records...');
    const typesenseDocs: any[] = [];

    for (const sample of sampleBusinesses) {
      const existing = await db.query.businesses.findFirst({
        where: eq(schema.businesses.slug, sample.slug),
      });

      let businessId = existing?.id;

      if (!existing) {
        const [created] = await db
          .insert(schema.businesses)
          .values({
            name: sample.name,
            legalName: sample.legalName,
            slug: sample.slug,
            industryId: industryMap[sample.industryCode] || null,
            businessType: sample.businessType,
            msmeCategory: sample.msmeCategory,
            opportunityTier: sample.opportunityTier,
            employeeCountRange: sample.employeeCountRange,
            annualRevenueRange: sample.annualRevenueRange,
            foundingYear: sample.foundingYear,
            incorporationDate: new Date(`${sample.foundingYear}-04-01T00:00:00Z`),
            description: sample.description,
            status: 'PUBLISHED',
            isVerified: true,
            isEnriched: true,
            publishedAt: new Date(),
          })
          .returning();

        businessId = created.id;

        // Insert Location
        await db.insert(schema.businessLocations).values({
          businessId,
          addressLine1: sample.location.addressLine1,
          city: sample.location.city,
          district: sample.location.district,
          state: sample.location.state,
          pincode: sample.location.pincode,
          country: 'India',
          isPrimary: true,
        });

        // Insert Contact
        await db.insert(schema.businessContacts).values({
          businessId,
          fullName: sample.contact.fullName,
          title: sample.contact.title,
          department: sample.contact.department,
          email: sample.contact.email,
          phone: sample.contact.phone,
          isEmailVerified: true,
          isPhoneVerified: true,
          isPrimary: true,
          isDecisionMaker: true,
        });

        // Insert Digital Presence
        if (sample.website) {
          await db.insert(schema.digitalPresences).values({
            businessId,
            platform: 'WEBSITE',
            url: sample.website,
            domain: sample.website.replace('https://', ''),
            isVerified: true,
            techStackDetected: sample.technologies,
          });
        }

        // Insert Score
        await db.insert(schema.businessScores).values({
          businessId,
          orionScore: sample.orionScore,
          scoreVersion: 'v1.0',
          weightsApplied: {},
          calculatedAt: new Date(),
        });

        // Insert Metric
        await db.insert(schema.businessMetrics).values({
          businessId,
          completenessScore: 85,
          verificationScore: 90,
          freshnessScore: 95,
          digitalPresenceScore: sample.website ? 85 : 40,
          confidenceScore: 90,
        });

        console.log(`✓ Seeded business: ${sample.name} (${sample.location.city}, ${sample.location.state})`);
      }

      const industryName = baselineIndustries.find((i) => i.code === sample.industryCode)?.name || 'General';

      typesenseDocs.push({
        id: businessId,
        name: sample.name,
        legal_name: sample.legalName,
        slug: sample.slug,
        status: 'PUBLISHED',
        industry_id: industryMap[sample.industryCode] || '',
        industry_name: industryName,
        business_type: sample.businessType,
        msme_category: sample.msmeCategory,
        state: sample.location.state,
        district: sample.location.district,
        city: sample.location.city,
        pincode: sample.location.pincode,
        has_website: Boolean(sample.website),
        has_email: Boolean(sample.contact.email),
        has_phone: Boolean(sample.contact.phone),
        has_gstin: true,
        orion_score: sample.orionScore,
        opportunity_tier: sample.opportunityTier,
        completeness_score: 85,
        verification_score: 90,
        freshness_score: 95,
        digital_presence_score: sample.website ? 85 : 40,
        confidence_score: 90,
        founding_year: sample.foundingYear,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      });
    }

    // Index documents into Typesense
    console.log('Syncing documents to Typesense cluster...');
    const typesenseHost = process.env.TYPESENSE_HOST || 'localhost';
    const typesensePort = Number(process.env.TYPESENSE_PORT || 8108);
    const typesenseProtocol = process.env.TYPESENSE_PROTOCOL || 'http';
    const typesenseApiKey = process.env.TYPESENSE_API_KEY || 'xyz123_orion_typesense_master_key';

    const tsClient = new TypesenseClient({
      nodes: [
        {
          host: typesenseHost,
          port: typesensePort,
          protocol: typesenseProtocol,
        },
      ],
      apiKey: typesenseApiKey,
      connectionTimeoutSeconds: 5,
    });

    try {
      // Check if collection exists; create if missing
      try {
        await tsClient.collections(BUSINESSES_SEARCH_COLLECTION).retrieve();
        console.log(`✓ Typesense collection '${BUSINESSES_SEARCH_COLLECTION}' already exists.`);
      } catch {
        console.log(`Creating Typesense collection '${BUSINESSES_SEARCH_COLLECTION}'...`);
        await tsClient.collections().create(BUSINESSES_COLLECTION_SCHEMA);
        console.log(`✓ Created Typesense collection '${BUSINESSES_SEARCH_COLLECTION}'.`);
      }

      // Upsert documents
      for (const doc of typesenseDocs) {
        await tsClient.collections(BUSINESSES_SEARCH_COLLECTION).documents().upsert(doc);
      }
      console.log(`✓ Successfully indexed ${typesenseDocs.length} businesses into Typesense!`);
    } catch (tsErr: any) {
      console.warn('⚠️ Typesense indexing warning (fallback to PostgreSQL active):', tsErr.message);
    }

    console.log('✓ Seeding & search index synchronization completed successfully.');
  } catch (error) {
    console.error('✗ Seeding failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedDatabase();
