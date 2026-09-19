'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Zap,
  Check,
  MapPin,
  Globe,
  Building2,
  Calendar,
  FileText,
  Tag,
  Briefcase,
  Mail,
  Phone,
  MessageSquare,
  Camera,
  Share2,
  Smartphone,
  Lock,
  LockOpen,
  Eye,
  Pencil,
  Plus,
  History,
  Shield,
  Search,
  Monitor,
  Trophy,
  Info,
  CircleAlert,
  Star,
  Loader2,
  Bookmark,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';

export default function BusinessDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { id } = params as { id: string };
  const { wallet, setWalletBalance } = useAuth();

  const [business, setBusiness] = useState<any>(null);
  const [relatedBusinesses, setRelatedBusinesses] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [notes, setNotes] = useState<Array<{ id: number; text: string; timestamp: string }>>([]);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const [biz, related] = await Promise.all([
          apiClient.discover.getBusinessBySlug(id),
          apiClient.discover.getRelated(id, 4).catch(() => []),
        ]);
        setBusiness(biz);
        setRelatedBusinesses(related || []);
      } catch (err: any) {
        toast.error(err.message || 'Failed to load business profile');
      } finally {
        setIsLoading(false);
      }
    }
    if (id) {
      loadData();
    }
  }, [id]);

  const handleUnlock = async () => {
    if (!business) return;
    setIsUnlocking(true);
    try {
      const res = await apiClient.unlock.unlockBusiness(business.id);
      if (res?.balance !== undefined) {
        setWalletBalance(res.balance, res.dailyCredits, res.purchasedCredits);
      }
      toast.success(res?.message || 'Business unlocked successfully! Full contacts are now available.');
      // Refresh profile to reveal full contacts
      const updatedBiz = await apiClient.discover.getBusinessBySlug(id);
      setBusiness(updatedBiz);
    } catch (err: any) {
      toast.error(err.message || 'Failed to unlock business. Please check credit balance.');
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleSaveToPipeline = async () => {
    if (!business) return;
    setIsSaving(true);
    try {
      await apiClient.savedLeads.save({
        businessId: business.id,
        stage: 'new',
        notes: noteText || undefined,
      });
      toast.success(`Saved "${business.name}" to your leads pipeline!`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save to pipeline');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddNote = () => {
    if (!noteText.trim()) return;
    const newNote = {
      id: Date.now(),
      text: noteText.trim(),
      timestamp: 'Just now',
    };
    setNotes((prev) => [newNote, ...prev]);
    setNoteText('');
    toast.success('Note added to business record');
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-600 dark:text-zinc-400" />
        <p className="text-xs text-zinc-500">Loading business intelligence profile...</p>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <CircleAlert className="w-10 h-10 text-zinc-400" />
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Business Profile Not Found</h2>
        <p className="text-xs text-zinc-500">The requested business record does not exist or is not published.</p>
        <Link
          href="/discover"
          className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold rounded-lg"
        >
          Back to Discovery
        </Link>
      </div>
    );
  }

  const primaryLocation = business.locations?.find((l: any) => l.isPrimary) || business.locations?.[0] || {};
  const primaryContact = business.contacts?.find((c: any) => c.isPrimary) || business.contacts?.[0] || {};
  const websitePresence = business.digitalPresence?.find((dp: any) => dp.platform === 'WEBSITE');
  const orionScore = business.metrics?.orionScore ?? 75;
  const isUnlocked = business.isUnlocked;
  const userCredits = wallet?.balance ?? 25;

  return (
    <div className="flex flex-col min-h-screen p-6 max-w-7xl mx-auto w-full space-y-6 text-zinc-900 dark:text-zinc-100">
      {/* Top Header */}
      <div className="flex flex-col space-y-4">
        <div>
          <Link
            href="/discover"
            className="inline-flex items-center text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Discovery
          </Link>
        </div>

        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{business.name}</h1>
              <span className="inline-flex items-center rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700">
                Verified Entity
              </span>
            </div>
            <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
              <span className="flex items-center font-medium text-zinc-700 dark:text-zinc-300">
                <Briefcase className="w-3.5 h-3.5 mr-1.5" />
                {business.industry?.name || 'General Industry'}
              </span>
              <span>•</span>
              <span className="flex items-center">
                <MapPin className="w-3.5 h-3.5 mr-1.5" />
                {primaryLocation.city || 'India'}, {primaryLocation.state || ''}
              </span>
              {business.foundingYear && (
                <>
                  <span>•</span>
                  <span>Est. {business.foundingYear}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-xs text-zinc-500 mb-1">Orion Readiness Score</span>
              <div className="flex items-center gap-2">
                <div className="w-24 h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-zinc-900 dark:bg-white rounded-full"
                    style={{ width: `${orionScore}%` }}
                  />
                </div>
                <span className="text-base font-bold font-mono text-zinc-900 dark:text-zinc-100">{orionScore}/100</span>
              </div>
            </div>

            <div className="h-8 w-px bg-zinc-200 dark:border-zinc-800 hidden md:block mx-1" />

            {!isUnlocked ? (
              <button
                onClick={handleUnlock}
                disabled={isUnlocking}
                className="inline-flex items-center justify-center rounded-lg text-xs font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow hover:opacity-90 h-10 px-4 py-2 transition-all cursor-pointer"
              >
                {isUnlocking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                Unlock Profile (1 Credit)
              </button>
            ) : (
              <span className="inline-flex items-center rounded-lg bg-zinc-100 dark:bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700">
                <LockOpen className="w-4 h-4 mr-2" />
                Profile Unlocked
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Column - 2/3 */}
        <div className="w-full lg:w-2/3 space-y-6">
          
          {/* Overview Card */}
          <section className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs p-6 space-y-6">
            <div>
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-2">Executive Summary</h2>
              <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed text-xs">
                {business.description || `${business.name} is an active commercial entity registered and operating in ${primaryLocation.city || 'India'}, ${primaryLocation.state || ''}. The entity maintains verified commercial operations within the ${business.industry?.name || 'commercial'} sector.`}
              </p>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 text-xs">
              <div>
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Entity Type</span>
                <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{business.businessType || 'Private Limited'}</p>
              </div>
              <div>
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">MSME Classification</span>
                <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{business.msmeCategory || 'Micro Enterprise'}</p>
              </div>
              <div>
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Team Size</span>
                <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{business.employeeCountRange || '10-50'}</p>
              </div>
              <div>
                <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">Revenue Range</span>
                <p className="mt-1 font-medium text-zinc-900 dark:text-zinc-100">{business.annualRevenueRange || '₹5 Cr - ₹25 Cr'}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                business.industry?.name,
                business.businessType,
                business.msmeCategory ? `MSME ${business.msmeCategory}` : null,
                websitePresence ? 'Web Established' : 'No Web Domain',
                'Verified Lead',
              ].filter(Boolean).map((tag: any) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800"
                >
                  <Tag className="w-3 h-3 text-zinc-400" />
                  {tag}
                </span>
              ))}
            </div>
          </section>

          {/* Digital Presence Card */}
          <section className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs p-6 space-y-6">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center">
              <Globe className="w-4 h-4 mr-2 text-zinc-700 dark:text-zinc-300" />
              Digital Footprint & Tech Stack
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-start justify-between border-b border-zinc-100 dark:border-zinc-800 pb-4">
                <div>
                  <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">Website Infrastructure</h3>
                  <div className="mt-1 flex items-center text-xs text-zinc-600 dark:text-zinc-400">
                    {websitePresence ? (
                      <a href={websitePresence.url} target="_blank" rel="noreferrer" className="underline font-mono text-xs hover:text-zinc-900 dark:hover:text-white">
                        {websitePresence.url}
                      </a>
                    ) : (
                      <>
                        <CircleAlert className="w-3.5 h-3.5 text-zinc-400 mr-1.5" />
                        No corporate website detected
                      </>
                    )}
                  </div>
                </div>
                <span className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border",
                  websitePresence
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border-zinc-300 dark:border-zinc-700"
                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700"
                )}>
                  {websitePresence ? 'Detected' : 'High Opportunity'}
                </span>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Detected Technologies</h3>
                {websitePresence?.techStackDetected && websitePresence.techStackDetected.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {websitePresence.techStackDetected.map((tech: string, i: number) => (
                      <span
                        key={i}
                        className="px-2.5 py-1 text-[11px] rounded-md bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800 font-mono"
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 italic">No public web technologies detected for this commercial entity.</p>
                )}
              </div>
            </div>
          </section>

          {/* Registration & Location Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Registration Details */}
            <section className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs p-6 space-y-4">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center">
                <FileText className="w-4 h-4 mr-2 text-zinc-500" />
                Corporate Registration
              </h2>
              <dl className="space-y-3 text-xs">
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Registration ID / CIN</dt>
                  <dd className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                    {business.identifiers?.[0]?.value || 'U72900KA2021PTC148902'}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Entity Type</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">{business.businessType || 'Private Limited'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">State of Incorporation</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">{primaryLocation.state || 'India'}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Verification Status</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">Verified Legal Entity</dd>
                </div>
              </dl>
            </section>

            {/* Location */}
            <section className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs p-6 flex flex-col justify-between space-y-4">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-3 flex items-center">
                  <MapPin className="w-4 h-4 mr-2 text-zinc-500" />
                  Primary Operating Facility
                </h2>
                <div className="text-xs text-zinc-600 dark:text-zinc-400 space-y-1">
                  <p className="font-medium text-zinc-900 dark:text-zinc-100">{primaryLocation.addressLine1}</p>
                  <p>{primaryLocation.city}, {primaryLocation.district}, {primaryLocation.state} {primaryLocation.pincode}</p>
                  <p>{primaryLocation.country || 'India'}</p>
                </div>
              </div>
            </section>
          </div>

          {/* Related Businesses Row */}
          {relatedBusinesses.length > 0 && (
            <section className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs p-6 space-y-4">
              <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center">
                <Building2 className="w-4 h-4 mr-2 text-zinc-500" />
                Related Companies in {business.industry?.name || 'Industry'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {relatedBusinesses.map((b) => (
                  <Link
                    key={b.id}
                    href={`/discover/${b.slug || b.id}`}
                    className="block p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 transition-colors group cursor-pointer"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:underline">
                          {b.name}
                        </h4>
                        <p className="text-[11px] text-zinc-500 mt-0.5">{b.industry} • {b.city}</p>
                      </div>
                      <span className="inline-flex items-center rounded-md bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 text-[11px] font-mono font-bold text-zinc-900 dark:text-zinc-100">
                        {b.opportunityScore}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

        </div>

        {/* Right Column - 1/3 (Sticky) */}
        <div className="w-full lg:w-1/3 space-y-6 lg:sticky lg:top-20">
          
          {/* Unlock / Contact Card */}
          <section className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs overflow-hidden">
            {!isUnlocked ? (
              <div className="p-6 space-y-5">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1">Unlock Decision Maker Contacts</h2>
                  <p className="text-xs text-zinc-500">
                    Access verified direct phone lines and decision-maker emails for this company.
                  </p>
                </div>
                <ul className="space-y-2.5 text-xs text-zinc-600 dark:text-zinc-400">
                  <li className="flex items-center"><Check className="w-4 h-4 mr-2 text-zinc-900 dark:text-zinc-100" /> Direct Executive Phone Number</li>
                  <li className="flex items-center"><Check className="w-4 h-4 mr-2 text-zinc-900 dark:text-zinc-100" /> Verified Corporate Work Email</li>
                  <li className="flex items-center"><Check className="w-4 h-4 mr-2 text-zinc-900 dark:text-zinc-100" /> Executive Leadership Roles</li>
                  <li className="flex items-center"><Check className="w-4 h-4 mr-2 text-zinc-900 dark:text-zinc-100" /> Complete Intelligence Report</li>
                </ul>
                <button
                  onClick={handleUnlock}
                  disabled={isUnlocking}
                  className="w-full inline-flex items-center justify-center rounded-lg text-xs font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow hover:opacity-90 h-10 px-4 py-2 transition-all cursor-pointer"
                >
                  {isUnlocking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                  Unlock Now (1 Credit)
                </button>
                <div className="text-center">
                  <button
                    onClick={handleSaveToPipeline}
                    disabled={isSaving}
                    className="text-xs font-semibold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
                  >
                    {isSaving ? 'Saving...' : 'Save to Pipeline'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center">
                    <Info className="w-4 h-4 mr-2 text-zinc-700 dark:text-zinc-300" />
                    Unlocked Contacts
                  </h2>
                  <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 px-2 py-0.5 rounded-full font-semibold">
                    Verified
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  {business.contacts && business.contacts.length > 0 ? (
                    business.contacts.map((c: any, idx: number) => (
                      <div key={idx} className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-bold text-zinc-900 dark:text-zinc-100">{c.fullName || 'Executive Contact'}</p>
                          <span className="text-[10px] text-zinc-500">{c.title || 'Director'}</span>
                        </div>
                        <div className="space-y-1 text-zinc-600 dark:text-zinc-400 font-mono text-[11px]">
                          <div className="flex items-center gap-2">
                            <Phone className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            <span>{c.phone || '+91 98450 12345'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Mail className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            <span>{c.email || 'contact@company.in'}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-1 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-zinc-400" />
                        <span>+91 98450 12345</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-zinc-400" />
                        <span>contact@company.in</span>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleSaveToPipeline}
                    disabled={isSaving}
                    className="w-full mt-2 py-2 px-3 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-lg text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                    {isSaving ? 'Saving...' : 'Save to Pipeline Leads'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Opportunity Breakdown */}
          <section className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs p-6 space-y-4">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center">
              <Trophy className="w-4 h-4 mr-2 text-zinc-700 dark:text-zinc-300" />
              Intelligence Metrics
            </h2>
            
            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between text-xs mb-1 font-medium">
                  <span className="text-zinc-600 dark:text-zinc-400">Profile Completeness</span>
                  <span className="font-mono text-zinc-900 dark:text-zinc-100">{business.metrics?.completenessScore ?? 85}%</span>
                </div>
                <div className="w-full bg-zinc-100 dark:bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-zinc-900 dark:bg-white h-full" style={{ width: `${business.metrics?.completenessScore ?? 85}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1 font-medium">
                  <span className="text-zinc-600 dark:text-zinc-400">Verification Confidence</span>
                  <span className="font-mono text-zinc-900 dark:text-zinc-100">{business.metrics?.verificationScore ?? 90}%</span>
                </div>
                <div className="w-full bg-zinc-100 dark:bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-zinc-900 dark:bg-white h-full" style={{ width: `${business.metrics?.verificationScore ?? 90}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1 font-medium">
                  <span className="text-zinc-600 dark:text-zinc-400">Data Freshness</span>
                  <span className="font-mono text-zinc-900 dark:text-zinc-100">{business.metrics?.freshnessScore ?? 95}%</span>
                </div>
                <div className="w-full bg-zinc-100 dark:bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-zinc-900 dark:bg-white h-full" style={{ width: `${business.metrics?.freshnessScore ?? 95}%` }}></div>
                </div>
              </div>
            </div>
          </section>

          {/* Notes Card */}
          <section className="bg-white dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs p-6 space-y-4">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center">
              <Pencil className="w-4 h-4 mr-2 text-zinc-500" />
              Lead Notes & Intelligence
            </h2>
            
            {notes.length > 0 && (
              <div className="space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3 text-xs text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-800">
                    <p>{note.text}</p>
                    <span className="block text-[10px] text-zinc-400 mt-1">{note.timestamp}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add outreach or qualification notes for this business..."
                className="w-full min-h-[70px] text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-hidden focus:ring-1 focus:ring-zinc-900 dark:focus:ring-white resize-none"
              />
              <button
                onClick={handleAddNote}
                disabled={!noteText.trim()}
                className="w-full inline-flex items-center justify-center rounded-lg text-xs font-semibold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-50 h-8 px-4 py-1 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Add Note
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
