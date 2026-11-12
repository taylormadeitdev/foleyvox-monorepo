import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AudioLines, Check, ChevronRight, CircleHelp, CloudUpload, FileText, Folder, Home, Mic2, Play, Search, Settings, Sparkles, UserRound, Volume2, X, LoaderCircle } from 'lucide-react';
import { Button } from '../components/Button';
import { FileDropzone } from '../components/FileDropzone';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/Dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/Select';
import { Textarea } from '../components/Textarea';
import { foleyvoxApi, FoleySession } from '../helpers/foleyvoxApi';
import styles from './_index.module.css';

type Screen = 'home' | 'loading' | 'studio' | 'characters' | 'projects' | 'settings' | 'profile';
type Track = { id: number; type: 'narrator' | 'character' | 'sfx'; label: string; text: string; left: number; width: number; character?: string; tone?: string };
type Chapter = { id: string; chapter_number: number; title: string; status: string; json_blueprint?: any; audio_path?: string | null; audio_url?: string | null; duration_seconds?: number | null; error_message?: string | null };

const voiceOptions = ['Mara – Warm & Resolute', 'Mara – Soft & Reflective', 'Mara – Wry & Dry', 'Mara – Fierce & Defiant', 'Mara – Gentle & Hopeful'];
const voiceIds: Record<string, string> = {
  'Mara – Warm & Resolute': 'en-US-AriaNeural', 'Mara – Soft & Reflective': 'en-US-JennyNeural',
  'Mara – Wry & Dry': 'en-US-AnaNeural', 'Mara – Fierce & Defiant': 'en-US-MichelleNeural',
  'Mara – Gentle & Hopeful': 'en-GB-SoniaNeural', 'Alaric – Steady & Noble': 'en-GB-RyanNeural',
  'Alaric – Weathered & Warm': 'en-US-GuyNeural', 'Alaric – Quiet & Intense': 'en-US-ChristopherNeural',
};
const toneOptions = ['Neutral', 'Angry', 'Sad', 'Whispering', 'Joyful', 'Fearful', 'Confident', 'Sarcastic', 'Urgent', 'Tender', 'Hopeful', 'Exhausted'];
const voiceModels = [
  { label: 'Aria — Warm & Expressive', id: 'en-US-AriaNeural', gender: 'Female' },
  { label: 'Jenny — Gentle & Clear', id: 'en-US-JennyNeural', gender: 'Female' },
  { label: 'Michelle — Rich & Dramatic', id: 'en-US-MichelleNeural', gender: 'Female' },
  { label: 'Sonia — Soft British', id: 'en-GB-SoniaNeural', gender: 'Female' },
  { label: 'Ryan — Steady British', id: 'en-GB-RyanNeural', gender: 'Male' },
  { label: 'Guy — Warm & Grounded', id: 'en-US-GuyNeural', gender: 'Male' },
  { label: 'Christopher — Deep & Intense', id: 'en-US-ChristopherNeural', gender: 'Male' },
];

const edgeVoiceAliases: Record<string, string> = {
  aria: 'en-US-AriaNeural', jenny: 'en-US-JennyNeural', michelle: 'en-US-MichelleNeural',
  sonia: 'en-GB-SoniaNeural', ryan: 'en-GB-RyanNeural', guy: 'en-US-GuyNeural',
  christopher: 'en-US-ChristopherNeural', ana: 'en-US-AnaNeural',
};
const toEdgeVoiceId = (value: unknown) => {
  const raw = String(value || '').trim();
  return edgeVoiceAliases[raw.toLowerCase()] || raw;
};
const statusLabel = (status: unknown) => {
  const value = String(status || '').toLowerCase();
  if (value === 'pending') return 'Ready for Review';
  if (value === 'rendering') return 'Rendering...';
  if (value === 'ready' || value === 'completed') return 'Ready';
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '—';
};

function getCharacterVoiceOptions(blueprint: any, character?: string) {
  if (!character) return [{ label: 'Narrator – Clear & Neutral', id: 'en-US-AriaNeural' }];
  const characters = blueprint?.characters;
  const data = Array.isArray(characters)
    ? characters.find((item: any) => String(item?.name || item?.character || item?.id || '').toLowerCase() === character.toLowerCase())
    : characters?.[character] || Object.entries(characters || {}).find(([name]) => name.toLowerCase() === character.toLowerCase())?.[1];
  const values = data?.voice_options || data?.voices || data?.voice_mapping || data?.available_voices;
  if (Array.isArray(values) && values.length) return values.map((item: any) => typeof item === 'string' ? { label: item, id: toEdgeVoiceId(voiceIds[item] || item) } : { label: String(item.label || item.name || item.description || item.voice_id || item.id || 'Voice'), id: toEdgeVoiceId(item.voice_id || item.id || item.voice || '') }).filter((item: any) => item.id);
  if (values && typeof values === 'object') return Object.entries(values).map(([label, value]: [string, any]) => ({ label, id: toEdgeVoiceId(value?.voice_id || value?.id || value) }));
  const assigned = data?.voice_id || data?.voice;
  if (assigned) return [{ label: String(data?.voice_name || data?.voice_label || assigned), id: toEdgeVoiceId(assigned) }];
  return [{ label: `${character} – Default`, id: 'en-US-AriaNeural' }];
}

export default function HomePage() {
  const [session, setSession] = useState<FoleySession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [screen, setScreen] = useState<Screen>('home');
  const [nav, setNav] = useState('Home');
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('Preparing your manuscript…');
  const [progress, setProgress] = useState(8);
  const [fileName, setFileName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [selectedChapter, setSelectedChapter] = useState(1);
  const [studioData, setStudioData] = useState<Chapter | null>(null);
  const [studioLoading, setStudioLoading] = useState(false);
  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [voice, setVoice] = useState(voiceOptions[0]);
  const [dialogue, setDialogue] = useState('');
  const [editCharacter, setEditCharacter] = useState('Narrator');
  const [editTone, setEditTone] = useState('Neutral');
  const [selectedCharacter, setSelectedCharacter] = useState('');
  const [characterVoice, setCharacterVoice] = useState('en-US-AriaNeural');
  const [characterGender, setCharacterGender] = useState<'Male' | 'Female' | 'Disembodied'>('Female');
  const [characterAgeRange, setCharacterAgeRange] = useState('Adult');
  const [savingCharacter, setSavingCharacter] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [apiError, setApiError] = useState('');
  const [rerendering, setRerendering] = useState(false);
  const [renderingChapters, setRenderingChapters] = useState<Set<number>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [chapterTitleDraft, setChapterTitleDraft] = useState('');
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [soundEffectsEnabled, setSoundEffectsEnabled] = useState(true);
  const [autoPreviewEnabled, setAutoPreviewEnabled] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [showForceStudio, setShowForceStudio] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [studioNotice, setStudioNotice] = useState('');
  const [adCredits, setAdCredits] = useState(0);
  const [adPlaying, setAdPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef('');

  useEffect(() => {
    setProfileMenuOpen(false);
  }, [screen]);

  useEffect(() => {
    let mounted = true;
    foleyvoxApi.getSession().then(async (current) => {
      if (!mounted) return;
      setSession(current); setAuthReady(true);
      if (current) {
        if (current.user?.id) showFirstWorkspaceOnboarding(current.user.id);
        try { setProjects(await foleyvoxApi.listProjects(current.access_token)); }
        catch (error) { setApiError(error instanceof Error ? error.message : 'Could not load projects.'); }
      }
    }).catch(() => { if (mounted) setAuthReady(true); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (screen !== 'loading') { setShowForceStudio(false); return; }
    setShowForceStudio(false);
    const timer = window.setTimeout(() => setShowForceStudio(true), 30_000);
    return () => window.clearTimeout(timer);
  }, [screen, projectId]);

  useEffect(() => () => {
    if (audioRef.current) audioRef.current.pause();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const chaptersSorted = useMemo(() => [...chapters].sort((a, b) => a.chapter_number - b.chapter_number), [chapters]);
  const blueprint = studioData?.json_blueprint || {};
  const characters = useMemo(() => {
    const names = new Set<string>();
    chaptersSorted.forEach((chapter) => {
      const data = chapter.json_blueprint || {};
      Object.keys(data.cast || {}).forEach((name) => names.add(name));
      Object.keys(data.canonical_cast || {}).forEach((name) => names.add(name));
      (Array.isArray(data.script) ? data.script : []).forEach((line: any) => { const name = String(line.speaker || ''); if (name) names.add(name); });
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [chaptersSorted]);
  const characterData = useMemo(() => {
    const data = blueprint.canonical_cast?.[selectedCharacter] || blueprint.characters?.[selectedCharacter] || {};
    return { ...data, gender: data.gender || blueprint.cast?.[selectedCharacter] || 'Character', aliases: data.aliases || [selectedCharacter] };
  }, [blueprint, selectedCharacter]);
  const filteredVoiceModels = characterGender === 'Disembodied' ? voiceModels : voiceModels.filter((item) => item.gender === characterGender);
  const activeVoiceOptions = useMemo(() => getCharacterVoiceOptions(blueprint, activeTrack?.character), [blueprint, activeTrack]);
  const tracks: Track[] = useMemo(() => {
    const lines = Array.isArray(blueprint.script) ? blueprint.script : [];
    const built: Track[] = [];
    lines.forEach((line: any, index: number) => {
      const speaker = String(line.speaker || 'Narrator');
      const isNarrator = speaker.toLowerCase() === 'narrator';
      built.push({ id: index + 1, type: isNarrator ? 'narrator' : 'character', label: speaker, character: isNarrator ? undefined : speaker, text: String(line.text || ''), left: Math.min(2 + (index % 5) * 3, 16), width: 72, tone: String(line.tone || '') });
      if (line.sound && String(line.sound).toLowerCase() !== 'none') built.push({ id: 10000 + index, type: 'sfx', label: 'SFX', text: String(line.sound), left: Math.min(4 + (index % 4) * 4, 20), width: 48 });
    });
    return built;
  }, [blueprint]);

  useEffect(() => {
    if (!selectedCharacter) return;
    const genderValue = String(characterData.gender || '').toLowerCase();
    const gender = ['Male', 'Female', 'Disembodied'].find((value) => value.toLowerCase() === genderValue);
    const storedVoice = blueprint.character_voices?.[selectedCharacter] || blueprint.canonical_cast?.[selectedCharacter]?.voice_id;
    const voiceGender = voiceModels.find((item) => item.id === storedVoice)?.gender || voiceModels.find((item) => item.id === characterVoice)?.gender;
    const ageRange = characterData.age_range || characterData.ageRange;
    setCharacterGender((gender || voiceGender || 'Female') as 'Male' | 'Female' | 'Disembodied');
    setCharacterAgeRange(['Child', 'Teen', 'Adult', 'Elderly'].includes(ageRange) ? ageRange : 'Adult');
  }, [blueprint, characterData, selectedCharacter]);

  const refreshProjects = async (current = session) => {
    if (current) setProjects(await foleyvoxApi.listProjects(current.access_token));
  };

  const showFirstWorkspaceOnboarding = (userId: string) => {
    const onboardingKey = `foleyvox.onboarding.user.${userId}`;
    if (localStorage.getItem(onboardingKey)) return;
    setOnboardingStep(0);
    setOnboardingOpen(true);
    localStorage.setItem(onboardingKey, 'shown');
  };

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault(); setAuthBusy(true); setAuthError('');
    try {
      const next = authMode === 'signin' ? await foleyvoxApi.signIn(email.trim(), password) : await foleyvoxApi.signUp(email.trim(), password);
      if (!next) setAuthError('Check your email for the confirmation link, then return here to sign in.');
      else { setSession(next); if (next.user?.id) showFirstWorkspaceOnboarding(next.user.id); await refreshProjects(next); }
    } catch (error) { setAuthError(error instanceof Error ? error.message : 'Authentication failed.'); }
    finally { setAuthBusy(false); }
  };

  const logout = async () => {
    if (session) await foleyvoxApi.signOut(session.access_token);
    setSession(null); setProjects([]); setProjectId(''); setChapters([]); setStudioData(null); setScreen('home');
  };

  const enterStudioFromSupabase = async (id: string, token: string) => {
    const result = await foleyvoxApi.getProjectDirect(token, id);
    const rows = result.chapters as Chapter[];
    setChapters(rows);
    setSelectedChapter(rows[0]?.chapter_number || 1);
    setStudioData(rows[0] || null);
    setProgress(100); setScreen('studio'); setNav('Projects');
    try { await refreshProjects({ ...session!, access_token: token }); } catch { /* Studio does not depend on the library refresh. */ }
  };

  const monitorProject = async (id: string, token: string) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 3000));
      try {
        const result = await foleyvoxApi.getProjectDirect(token, id);
        const rows = result.chapters as Chapter[];
        const status = String(result.project?.status || '').toLowerCase();
        const allReady = rows.length > 0 && rows.every((row) => ['ready', 'completed'].includes(String(row.status || '').toLowerCase()));
        setChapters(rows);
        if (status === 'ready' || allReady) {
          setProgress(100);
          setSelectedChapter(rows[0]?.chapter_number || 1);
          setStudioData(rows[0] || null);
          setScreen('studio'); setNav('Projects');
          try { await refreshProjects({ ...session!, access_token: token }); } catch { /* ignore optional refresh */ }
          return;
        }
        if (status === 'failed' && !rows.length) throw new Error(result.project?.error_message || 'Manuscript processing failed.');
        setProgress((value) => Math.min(99, value + 1));
        setUploadMessage(status === 'processing' ? 'Analyzing manuscript with Gemini…' : 'Checking chapter production directly in Supabase…');
      } catch (error) {
        console.warn('[FoleyVox] Direct Supabase status check failed; retrying.', error);
        // If the browser's authenticated PostgREST read is denied (for
        // example by an RLS/token issue), use the authenticated API as a
        // completion fallback rather than silently pinning the UI at 96%.
        try {
          const fallback = await foleyvoxApi.getProject(token, id);
          const fallbackRows = (fallback.chapters || []) as Chapter[];
          const fallbackStatus = String(fallback.project?.status || '').toLowerCase();
          const fallbackReady = fallbackRows.length > 0 && fallbackRows.every((row) => ['ready', 'completed'].includes(String(row.status || '').toLowerCase()));
          setChapters(fallbackRows);
          if (fallbackStatus === 'ready' || fallbackReady) {
            setProgress(100); setSelectedChapter(fallbackRows[0]?.chapter_number || 1); setStudioData(fallbackRows[0] || null);
            setScreen('studio'); setNav('Projects'); return;
          }
          setUploadMessage('Supabase access is unavailable; checking through the project API…');
        } catch (fallbackError) {
          setUploadMessage(fallbackError instanceof Error ? `Status check: ${fallbackError.message}` : 'Unable to read project status. Retrying…');
        }
      }
    }
    // Leave the loading screen visible; the 30-second escape hatch remains available.
  };

  const forceEnterStudio = async () => {
    if (!projectId || !session) return;
    try { await enterStudioFromSupabase(projectId, session.access_token); }
    catch { setChapters([]); setStudioData(null); setSelectedChapter(1); setProgress(100); setScreen('studio'); setNav('Projects'); }
    setStudioNotice('Your manuscript is still processing in the background. Chapters will appear here automatically.');
  };

  const startProcessing = async (file?: File) => {
    if (!file || !session) return;
    setApiError('');
    if (!/\.(txt|md|docx)$/i.test(file.name)) { setApiError('Please choose a .txt, .md, or .docx manuscript.'); return; }
    if (/\.docx$/i.test(file.name)) { setApiError('DOCX upload is accepted in this prototype, but document extraction is not connected yet. Render needs python-docx parsing before this file can be processed. Your original file has not been uploaded.'); return; }
    if (file.size > 2 * 1024 * 1024) { setApiError('Please keep the manuscript under 2 MB for this first live version.'); return; }
    setFileName(file.name); setUploading(true); setUploadMessage('Creating your project…'); setProgress(8);
    try {
      const project = await foleyvoxApi.createProject(session.access_token, session.user.id, file.name.replace(/\.txt$/i, ''));
      setProjectId(project.id); setUploadMessage('Uploading manuscript securely to Supabase…'); setProgress(18);
      const uploadFile = /\.md$/i.test(file.name) ? new File([await file.text()], file.name.replace(/\.md$/i, '.txt'), { type: 'text/plain' }) : file;
      await foleyvoxApi.uploadManuscript(session.access_token, session.user.id, project.id, uploadFile);
      setUploading(false); setScreen('loading'); setProgress(12); setUploadMessage('Queued for audio production…');
      await monitorProject(project.id, session.access_token);
    } catch (error) {
      setUploading(false); setScreen('home'); setApiError(error instanceof Error ? error.message : 'Upload failed.');
      try { await refreshProjects(); } catch { /* preserve upload error */ }
    }
  };

  const openProject = async (project: any) => {
    if (!session) return;
    setApiError(''); setProjectId(project.id); setFileName(project.title || 'Untitled project');
    try {
      const result = await foleyvoxApi.getProject(session.access_token, project.id);
      const rows = (result.chapters || []) as Chapter[];
      setChapters(rows);
      setSelectedChapter(rows[0]?.chapter_number || 1);
      setStudioData(rows[0] || null);
      setScreen('studio'); setNav('Projects');
      if (session.user?.id) showFirstWorkspaceOnboarding(session.user.id);
      if (!rows.length) setApiError(project.error_message || 'This project is still being prepared. You can return to it shortly.');
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Could not open this project.'); }
  };

  useEffect(() => {
    if (!session || !projectId || screen !== 'studio') return;
    let active = true; setStudioLoading(true);
    foleyvoxApi.getStudio(session.access_token, projectId, selectedChapter)
      .then((data) => { if (active) setStudioData(data); })
      .catch((error) => { if (active) setApiError(error instanceof Error ? error.message : 'Could not load chapter data.'); })
      .finally(() => { if (active) setStudioLoading(false); });
    return () => { active = false; };
  }, [session, projectId, selectedChapter, screen]);

  const openTrack = (track: Track) => {
    if (track.type === 'sfx') return;
    setActiveTrack(track); setEditCharacter(track.character || 'Narrator');
    setEditTone(track.tone || 'Neutral'); setDialogue(track.text || ''); setPlaying(false);
  };

  const hearVoice = async () => {
    if (!session || !dialogue.trim()) return;
    try {
      if (audioRef.current && playing) { audioRef.current.pause(); audioRef.current = null; setPlaying(false); return; }
      const selectedVoice = activeVoiceOptions.find((option) => option.label === voice);
      const response = await foleyvoxApi.previewVoice(session.access_token, selectedVoice?.id || voiceIds[voice] || 'en-US-AriaNeural', dialogue.trim());
      const blob = await response.blob();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob); previewUrlRef.current = url;
      const audio = new Audio(url); audioRef.current = audio; audio.onended = () => setPlaying(false);
      await audio.play(); setPlaying(true);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Voice preview failed.'); setPlaying(false); }
  };

  const saveDialogueLine = async () => {
    if (!session || !studioData || !activeTrack) return;
    const nextBlueprint = { ...blueprint, script: [...(Array.isArray(blueprint.script) ? blueprint.script : [])] };
    const index = activeTrack.id - 1;
    if (!nextBlueprint.script[index]) return;
    nextBlueprint.script[index] = { ...nextBlueprint.script[index], speaker: editCharacter, tone: editTone, text: dialogue };
    setSavingCharacter(true);
    try {
      await foleyvoxApi.saveChapterBlueprint(session.access_token, studioData.id, nextBlueprint);
      setStudioData({ ...studioData, json_blueprint: nextBlueprint });
      setChapters((rows) => rows.map((row) => row.id === studioData.id ? { ...row, json_blueprint: nextBlueprint } : row));
      setActiveTrack(null);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Could not save the dialogue edit.'); }
    finally { setSavingCharacter(false); }
  };

  const saveCharacterVoice = async () => {
    if (!session || !selectedCharacter) return;
    setSavingCharacter(true); setApiError('');
    try {
      const voiceId = characterVoice;
      const updated = await Promise.all(chaptersSorted.map(async (chapter) => {
        const source = chapter.json_blueprint || {};
        const canonical = { ...(source.canonical_cast || {}) };
        canonical[selectedCharacter] = { ...(canonical[selectedCharacter] || {}), voice_id: voiceId, gender: characterGender, age_range: characterAgeRange };
        const next = { ...source, canonical_cast: canonical, character_voices: { ...(source.character_voices || {}), [selectedCharacter]: voiceId } };
        const savedRows = await foleyvoxApi.saveChapterBlueprint(session.access_token, chapter.id, next);
        const savedChapter = Array.isArray(savedRows) ? savedRows.find((row) => row.id === chapter.id) : undefined;
        if (
          savedChapter?.json_blueprint?.character_voices?.[selectedCharacter] !== voiceId ||
          savedChapter?.json_blueprint?.canonical_cast?.[selectedCharacter]?.voice_id !== voiceId
        ) {
          throw new Error(`Supabase did not persist the selected voice for Chapter ${chapter.chapter_number}.`);
        }
        return { ...chapter, json_blueprint: savedChapter.json_blueprint };
      }));
      setChapters(updated);
      if (studioData) setStudioData((current) => current ? { ...current, json_blueprint: updated.find((row) => row.id === current.id)?.json_blueprint || current.json_blueprint } : current);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Could not save this character voice across the book.'); }
    finally { setSavingCharacter(false); }
  };

  const rerenderChapter = async (chapterNumber = selectedChapter) => {
    if (!session || !projectId) return;
    if (renderingChapters.has(chapterNumber)) return;
    const previousChapter = chapters.find((chapter) => chapter.chapter_number === chapterNumber);
    const previousStatus = previousChapter?.status || 'ready';
    const restoreRenderState = (message: string) => {
      setRenderingChapters((current) => { const next = new Set(current); next.delete(chapterNumber); return next; });
      setChapters((current) => current.map((chapter) => chapter.chapter_number === chapterNumber ? { ...chapter, status: previousStatus } : chapter));
      if (chapterNumber === selectedChapter) setStudioData((current) => current ? { ...current, status: previousStatus } : current);
      setApiError(message);
    };
    setRerendering(true); setRenderingChapters((current) => new Set(current).add(chapterNumber)); setApiError('');
    try {
      await foleyvoxApi.rerender(session.access_token, projectId, chapterNumber);
      setChapters((current) => current.map((chapter) => chapter.chapter_number === chapterNumber ? { ...chapter, status: 'rendering' } : chapter));
      if (chapterNumber === selectedChapter) setStudioData((current) => current ? { ...current, status: 'rendering', audio_url: null } : current);
      setToastMessage(`Rendering Chapter ${chapterNumber} in the background. You can keep editing.`);
      setStudioNotice('Chapter rendering takes time. You can safely navigate away while the backend works; your chapter will update when it is ready.');
      void (async () => {
        try {
          for (let i = 0; i < 120; i++) {
            await new Promise((resolve) => window.setTimeout(resolve, 4000));
            const data = await foleyvoxApi.getStudio(session.access_token, projectId, chapterNumber);
            setChapters((current) => current.map((chapter) => chapter.chapter_number === chapterNumber ? { ...chapter, ...data } : chapter));
            if (data.status === 'ready') {
              setRenderingChapters((current) => { const next = new Set(current); next.delete(chapterNumber); return next; });
              if (chapterNumber === selectedChapter) setStudioData(data);
              setToastMessage(`Chapter ${chapterNumber} is ready to play.`); return;
            }
            if (data.status === 'failed') throw new Error(data.error_message || `Chapter ${chapterNumber} render failed.`);
          }
          throw new Error(`Chapter ${chapterNumber} is taking longer than expected.`);
        } catch (error) {
          restoreRenderState(error instanceof Error ? error.message : 'Chapter render status could not be checked. You can retry the render.');
        }
      })();
    } catch (error) {
      restoreRenderState(error instanceof Error ? error.message : 'Chapter render request failed. You can retry the render.');
    }
    finally { setRerendering(false); }
  };

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(''), 5000);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const watchAdForCredit = async () => {
    setAdPlaying(true); setToastMessage('Playing a sponsored demo…');
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
    setAdPlaying(false); setAdCredits((value) => value + 1); setToastMessage('Demo complete — 1 render credit added to this session.');
  };

  const saveChapterTitle = async () => {
    if (!session || !studioData || !chapterTitleDraft.trim()) return;
    try {
      await foleyvoxApi.updateChapterTitle(session.access_token, studioData.id, chapterTitleDraft.trim());
      setStudioData((current) => current ? { ...current, title: chapterTitleDraft.trim() } : current);
      setChapters((current) => current.map((row) => row.id === studioData.id ? { ...row, title: chapterTitleDraft.trim() } : row));
      setEditingTitle(false);
    } catch (error) { setApiError(error instanceof Error ? error.message : 'Could not update chapter title.'); }
  };

  const filteredTracks = tracks.filter((track) => !searchTerm.trim() || `${track.label} ${track.text} ${track.tone || ''}`.toLowerCase().includes(searchTerm.trim().toLowerCase()));
  const navItems = [{ label: 'Home', icon: Home }, { label: 'Projects', icon: Folder }, { label: 'Settings', icon: Settings }];

  if (!authReady) return <main className={styles.appShell}><div className={styles.authCard}>Connecting to your FoleyVox account…</div></main>;
  if (!session) return (
    <main className={styles.appShell}><section className={styles.authScreen}><div className={styles.authCard}>
      <div className={styles.dialogBrand}><AudioLines size={26} /><span>Foley<span>Vox</span></span></div>
      <p className={styles.authEyebrow}>YOUR STORY, REIMAGINED</p><h1>{authMode === 'signin' ? 'Welcome back.' : 'Create your account.'}</h1>
      <p className={styles.authCopy}>Sign in securely with your FoleyVox account.</p>
      <form onSubmit={signIn} className={styles.authForm}>
        <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        <label>Password<input type="password" autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></label>
        {authError && <p className={styles.errorMessage}>{authError}</p>}
        <Button type="submit" className={styles.authSubmit} disabled={authBusy}>{authBusy ? 'Please wait…' : authMode === 'signin' ? 'Sign in' : 'Create account'}</Button>
      </form>
      <button className={styles.authSwitch} onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setAuthError(''); }}>{authMode === 'signin' ? 'New to FoleyVox? Create an account' : 'Already have an account? Sign in'}</button>
    </div></section></main>
  );

  return (
    <main className={styles.appShell}>
      {screen === 'loading' ? <section className={styles.loadingScreen}>
        <div className={styles.loadingBrand}><AudioLines size={34} strokeWidth={1.8} /><span>Foley<span>Vox</span></span></div>
        <div className={styles.loadingContent}><p className={styles.loadingEyebrow}>YOUR STORY, REIMAGINED</p><h1>Casting Characters...</h1>
          <div className={styles.progressRing} style={{ background: `conic-gradient(#ffb300 ${progress * 3.6}deg, #3a3021 0deg)` }}><div className={styles.progressInner}><strong>{progress}%</strong><span>COMPLETE</span></div></div>
          <p className={styles.loadingStep}>{uploadMessage}</p><p className={styles.loadingSubstep}><span className={styles.pulseDot} /> Render worker is processing your manuscript…</p>
          <div className={styles.loadingFile}><FileText size={15} /> {fileName}</div>
          {showForceStudio && <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: 440, margin: '24px auto 0', padding: 18, border: '1px solid #76552b', borderRadius: 12, background: 'rgba(35,28,18,.88)' }}><p style={{ margin: 0, color: '#c6b9a7', fontSize: 12, lineHeight: 1.5 }}>Production is taking longer than expected. You can enter the Studio now and check back as chapters finish.</p><Button className={styles.saveButton} onClick={forceEnterStudio}>Taking too long? Enter Studio while you wait.</Button></div>}
        </div><div className={styles.loadingFoot}><span /> A little magic takes a moment <span /></div>
      </section> : <>
        <header className={styles.topbar}>
          <div className={styles.brand}><div className={styles.brandMark}><AudioLines size={27} /></div><span>Foley<span>Vox</span></span><small>AI-POWERED AUDIO PRODUCTION</small></div>
          <div className={styles.topActions}>
            {(screen === 'studio' || screen === 'characters') && <div className={styles.projectPill}><span className={styles.statusDot} /> {fileName.replace(/\.txt$/i, '')}</div>}
            <Button variant="outline" size="icon" className={styles.iconButton} aria-label="Help"><CircleHelp size={18} /></Button>
            {screen === 'studio' && <Button className={styles.exportButton} onClick={() => { if (studioData?.audio_url) window.open(studioData.audio_url, '_blank'); else setApiError('This chapter does not have a rendered audio file yet.'); }}><Volume2 size={17} /> Play / Export</Button>}
            <div className={styles.profileMenuWrap}><Button variant="ghost" size="icon" className={styles.avatarButton} aria-label="Profile menu" onClick={() => setProfileMenuOpen((open) => !open)}><UserRound size={19} /></Button>{profileMenuOpen && <div className={styles.profileMenu}><button onClick={() => { setScreen('profile'); setProfileMenuOpen(false); }}><UserRound size={15} /> Profile</button><button onClick={logout}><X size={15} /> Sign Out</button></div>}</div>
          </div>
        </header>
        {screen === 'home' ? <div className={styles.homeContent}>
          <section className={styles.welcome}><div className={styles.welcomeKicker}><span /> THE AUTHOR’S SOUNDSTAGE</div><h1>Every story deserves<br /><em>to be heard.</em></h1><p>Turn your manuscript into an immersive, full-cast audio drama.</p></section>
          <section className={styles.uploadSection}>
            <div className={styles.uploadHeading}><span>01</span><div><h2>Bring your story to life</h2><p>Upload a TXT or Markdown manuscript. DOCX import is shown as a preview until document parsing is added to Render.</p></div></div>
            <div className={styles.uploadFrame}>
              <div className={`${styles.uploadCorner} ${styles.tl}`} /><div className={`${styles.uploadCorner} ${styles.tr}`} /><div className={`${styles.uploadCorner} ${styles.bl}`} /><div className={`${styles.uploadCorner} ${styles.br}`} />
              {uploading ? <div className={styles.uploadProgress}><div className={styles.uploadIcon}><CloudUpload size={31} /></div><h3>{uploadMessage}</h3><p>{fileName}</p><div className={styles.fakeProgress}><span style={{ width: `${progress}%` }} /></div><small>Secure upload in progress</small></div> :
                <FileDropzone className={styles.dropzone} accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" maxFiles={1} onFilesSelected={(files) => startProcessing(files[0])} icon={<CloudUpload size={42} strokeWidth={1.4} />} title={<><strong>Upload your Manuscript</strong><span>DRAG & DROP YOUR .TXT, .MD OR .DOCX FILE HERE</span></>} subtitle={<span className={styles.fileTypes}><i>.TXT</i><i>.MD</i><i>.DOCX PREVIEW</i><i>MAX 2 MB</i></span>} />}
            </div>
            <div className={styles.uploadHint}><Sparkles size={14} /> Your characters, voices, and soundscape—crafted in one place.</div>
            <p className={styles.backendNote}>Markdown is converted to plain text for the current worker. DOCX extraction is a UI preview only for now.</p>
          </section>
          <section className={styles.recentSection}>
            <div className={styles.sectionTitle}><div><span className={styles.sectionIndex}>02</span><h2>Recent Projects</h2></div><button onClick={() => { setScreen('projects'); setNav('Projects'); }}>Your Library <ChevronRight size={15} /></button></div>
            {projects.length ? <div className={styles.projectRail}>{projects.map((project) => <button className={styles.projectCard} key={project.id} onClick={() => openProject(project)}><div className={`${styles.bookCover} ${styles.crown}`}><span className={styles.coverOrnament}>✦</span><strong>{project.title}</strong><small>{project.status}</small><span className={styles.coverBottom}>FOLEYVOX EDITION</span></div><div className={styles.projectMeta}><strong>{project.title}</strong><small>{project.status} · {new Date(project.created_at).toLocaleDateString()}</small></div></button>)}</div> : <p className={styles.emptyProjects}>Your productions will appear here.</p>}
          </section>
        </div> : screen === 'projects' ? <section className={styles.simplePage}><p className={styles.charactersHeading}>YOUR LIBRARY</p><h1>Projects</h1>{projects.length ? <div className={styles.projectLibrary}>{projects.map((project) => <button key={project.id} className={styles.libraryProject} onClick={() => openProject(project)}><Folder size={20} /><span><strong>{project.title}</strong><small>{project.status} · {new Date(project.created_at).toLocaleDateString()}</small></span><ChevronRight size={17} /></button>)}</div> : <p className={styles.emptyProjects}>Your productions will appear here.</p>}</section> : screen === 'settings' ? <section className={styles.simplePage}><p className={styles.charactersHeading}>PREFERENCES</p><h1>Settings</h1><div className={styles.settingsPanel}><div><span><strong>Sound effects</strong><small>Include sound cues in your production workflow.</small></span><button className={soundEffectsEnabled ? styles.toggleOn : styles.toggleOff} onClick={() => setSoundEffectsEnabled((v) => !v)}>{soundEffectsEnabled ? 'On' : 'Off'}</button></div><div><span><strong>Automatic voice preview</strong><small>Preview voice selections when you change a model.</small></span><button className={autoPreviewEnabled ? styles.toggleOn : styles.toggleOff} onClick={() => setAutoPreviewEnabled((v) => !v)}>{autoPreviewEnabled ? 'On' : 'Off'}</button></div></div><div className={styles.plansSection}><p>CHOOSE YOUR PRODUCTION PLAN</p><h2>Plans &amp; Pricing</h2><div className={styles.planGrid}><article><h3>Free</h3><strong>$0<small>/mo</small></strong><ul><li>Basic manuscript workflow</li><li>Limited render credits</li></ul><Button variant="outline" disabled={adPlaying} onClick={watchAdForCredit}>{adPlaying ? 'Playing demo…' : 'Watch Ad for 1 Render Credit'}</Button><small>{adCredits} demo credit{adCredits === 1 ? '' : 's'} added this session</small></article><article className={styles.featuredPlan}><span>FOR INDIE AUTHORS</span><h3>Indie</h3><strong>$15<small>/mo</small></strong><ul><li>More monthly render credits</li><li>Full character and chapter editing</li><li>Standard audio exports</li></ul><Button variant="outline" onClick={() => setToastMessage('Indie checkout will be connected when billing is enabled.')}>Choose Indie</Button></article><article><h3>Studio</h3><strong>$49<small>/mo</small></strong><ul><li>Higher render allowance</li><li>Priority rendering</li><li>Advanced production workflow</li></ul><Button variant="outline" onClick={() => setToastMessage('Studio checkout will be connected when billing is enabled.')}>Choose Studio</Button></article></div><small className={styles.billingNote}>Plan prices are prototype UI only. Subscription checkout and real credit enforcement are not connected.</small></div></section> : screen === 'profile' ? <section className={styles.simplePage}><p className={styles.charactersHeading}>YOUR ACCOUNT</p><h1>Profile</h1><div className={styles.settingsPanel}><div><span><strong>Email address</strong><small>{session.user.email || 'Your FoleyVox account'}</small></span></div><div><span><strong>Account</strong><small>Signed in to FoleyVox</small></span><Button variant="outline" onClick={logout}>Sign Out</Button></div></div></section> : screen === 'characters' ? <><section className={styles.workspaceBar}><div><small>PROJECT WORKSPACE</small><strong>{fileName.replace(/\.txt$/i, '')}</strong></div><div><button className={styles.workspaceTab} onClick={() => setScreen('studio')}><AudioLines size={15} /> Studio</button><button className={styles.workspaceTabActive} onClick={() => setScreen('characters')}><UserRound size={15} /> Characters</button></div><button className={styles.backToProjects} onClick={() => { setScreen('projects'); setNav('Projects'); }}>All Projects</button></section><section className={styles.charactersPage}>
          <div className={styles.charactersHeading}><p>THE CAST OF YOUR STORY</p><h1>Characters</h1><span>Choose the voice that will carry each character through the entire book.</span></div>
          <div className={styles.characterWorkspace}>
            <aside className={styles.characterRoster}><h2>Cast <small>{characters.length}</small></h2>{characters.map((name) => <button key={name} className={selectedCharacter === name ? styles.characterSelected : ''} onClick={() => { setSelectedCharacter(name); const source = studioData?.json_blueprint || chaptersSorted.find((row) => row.json_blueprint)?.json_blueprint || {}; setCharacterVoice(source.character_voices?.[name] || source.canonical_cast?.[name]?.voice_id || voiceModels.find((v) => v.gender === (source.cast?.[name] || source.canonical_cast?.[name]?.gender))?.id || 'en-US-AriaNeural'); }}><UserRound size={17} /><span>{name}</span><ChevronRight size={15} /></button>)}</aside>
            <section className={styles.characterDetail}>{selectedCharacter ? <>
              <div className={styles.characterPortrait}><UserRound size={34} /></div><p className={styles.characterEyebrow}>CHARACTER PROFILE</p><h2>{selectedCharacter}</h2>
              <div className={styles.characterStats}><div><small>ROLE / VOICE TYPE</small><strong>{selectedCharacter.toLowerCase() === 'narrator' ? 'Narrator' : characterData.gender}</strong></div><div><small>ALIASES</small><strong>{(Array.isArray(characterData.aliases) ? characterData.aliases : [characterData.aliases || selectedCharacter]).map((alias: any) => String(alias || '').trim()).filter((alias: string, index: number, all: string[]) => alias && alias.toLowerCase() !== selectedCharacter.toLowerCase() && all.findIndex((item) => item.toLowerCase() === alias.toLowerCase()) === index).join(', ') || '—'}</strong></div><div><small>CHAPTER APPEARANCES</small><strong>{(() => { const count = chaptersSorted.filter((row) => (row.json_blueprint?.script || []).some((line: any) => String(line.speaker || '').toLowerCase() === selectedCharacter.toLowerCase())).length; return `${count} ${count === 1 ? 'chapter' : 'chapters'}`; })()}</strong></div></div>
              <div className={styles.characterVoiceBox}><label>GENDER</label><Select value={characterGender} onValueChange={(value) => { const gender = value as 'Male' | 'Female' | 'Disembodied'; const models = gender === 'Disembodied' ? voiceModels : voiceModels.filter((item) => item.gender === gender); setCharacterGender(gender); setCharacterVoice((current) => models.some((item) => item.id === current) ? current : models[0]?.id || current); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Male', 'Female', 'Disembodied'].map((gender) => <SelectItem key={gender} value={gender}>{gender}</SelectItem>)}</SelectContent></Select><label>AGE RANGE</label><Select value={characterAgeRange} onValueChange={setCharacterAgeRange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Child', 'Teen', 'Adult', 'Elderly'].map((ageRange) => <SelectItem key={ageRange} value={ageRange}>{ageRange}</SelectItem>)}</SelectContent></Select><label>BASE VOICE MODEL</label><Select value={characterVoice} onValueChange={setCharacterVoice}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{filteredVoiceModels.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select><div className={styles.characterVoiceActions}><Button variant="outline" onClick={async () => { if (!session) return; try { const response = await foleyvoxApi.previewVoice(session.access_token, characterVoice, `Hello. I am ${selectedCharacter}.`); const blob = await response.blob(); const url = URL.createObjectURL(blob); const audio = new Audio(url); audio.onended = () => URL.revokeObjectURL(url); await audio.play(); } catch (error) { setApiError(error instanceof Error ? error.message : 'Voice preview failed.'); } }}><Play size={15} /> Preview Voice</Button><Button className={styles.saveButton} disabled={savingCharacter} onClick={saveCharacterVoice}>{savingCharacter ? 'Saving…' : 'Apply to entire book'}</Button></div><p>Profile and voice settings are stored on every chapter blueprint. Re-render chapters to hear the updated performance.</p></div>
            </> : <div className={styles.characterEmpty}>Select a character from the cast to review their profile and voice.</div>}</section>
          </div>
        </section></> : <><section className={styles.workspaceBar}><div><small>PROJECT WORKSPACE</small><strong>{fileName.replace(/\.txt$/i, '')}</strong></div><div><button className={styles.workspaceTabActive} onClick={() => setScreen('studio')}><AudioLines size={15} /> Studio</button><button className={styles.workspaceTab} onClick={() => { setSelectedCharacter((current) => current || characters[0] || 'Narrator'); setScreen('characters'); }}><UserRound size={15} /> Characters</button></div><button className={styles.backToProjects} onClick={() => { setScreen('projects'); setNav('Projects'); }}>All Projects</button></section><div className={styles.studioLayout}>
          {studioNotice && <div className={styles.apiError} role="status"><span>{studioNotice}</span><button onClick={() => setStudioNotice('')}>Dismiss</button></div>}
          <aside className={styles.chapterPanel}>
            <div className={styles.panelHeader}><h2>Chapters</h2><span className={styles.chapterCount}>{chaptersSorted.length} {chaptersSorted.length === 1 ? 'chapter' : 'chapters'}</span></div>
            <div className={styles.chapterList}>{chaptersSorted.map((chapter) => <div key={chapter.id} className={`${styles.chapterItem} ${selectedChapter === chapter.chapter_number ? styles.chapterActive : ''}`}><button className={styles.chapterSelect} onClick={() => setSelectedChapter(chapter.chapter_number)}><span className={styles.chapterNumber}>{String(chapter.chapter_number).padStart(2, '0')}</span><span className={styles.chapterInfo}><strong>{chapter.title || `Chapter ${chapter.chapter_number}`}</strong><small>{statusLabel(chapter.status)}</small></span></button><Button size="sm" variant="outline" className={styles.chapterRenderButton} disabled={renderingChapters.has(chapter.chapter_number) || chapter.status === 'rendering'} onClick={() => { setSelectedChapter(chapter.chapter_number); rerenderChapter(chapter.chapter_number); }}>{renderingChapters.has(chapter.chapter_number) ? <><LoaderCircle size={13} className={styles.spinIcon} /> Rendering…</> : chapter.audio_url ? 'Re-render Chapter' : 'Render Chapter'}</Button></div>)}</div>
            <div className={styles.chapterFooter}><span><Check size={14} /> Live chapter data</span><small>{chaptersSorted.length} {chaptersSorted.length === 1 ? 'chapter' : 'chapters'} analyzed</small></div>
          </aside>
          <section className={styles.timelinePanel}>
            <div className={styles.timelineToolbar}><div className={styles.timelineTitle}><span className={styles.liveIndicator} /> <strong>Chapter {String(selectedChapter).padStart(2, '0')}</strong><span>·</span>{editingTitle ? <input className={styles.titleEditInput} value={chapterTitleDraft} autoFocus onChange={(event) => setChapterTitleDraft(event.target.value)} onBlur={saveChapterTitle} onKeyDown={(event) => { if (event.key === 'Enter') saveChapterTitle(); if (event.key === 'Escape') setEditingTitle(false); }} /> : <button className={styles.editableChapterTitle} onClick={() => { setChapterTitleDraft(studioData?.title || `Chapter ${selectedChapter}`); setEditingTitle(true); }}>{studioData?.title || 'Loading chapter…'} ✎</button>}</div><div className={styles.timelineTools}>{searchOpen && <input className={styles.timelineSearch} placeholder="Search dialogue…" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} autoFocus />}<button aria-label="Search timeline" onClick={() => { setSearchOpen((open) => !open); setSearchTerm(''); }}><Search size={17} /></button><Button size="sm" variant="outline" disabled={renderingChapters.has(selectedChapter) || studioLoading || !studioData} onClick={() => rerenderChapter(selectedChapter)}>{renderingChapters.has(selectedChapter) ? 'Rendering…' : studioData?.audio_path || studioData?.audio_url ? 'Re-render Chapter' : 'Render Chapter'}</Button></div></div>
            <div className={styles.timelineScroll}>
              {studioLoading ? <div className={styles.timelineLoading}>Fetching chapter JSON from FoleyVox API…</div> : filteredTracks.length ? <>
                <div className={styles.timeRuler}><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span><span>00:40</span><span>00:50</span></div>
                <div className={styles.timelineGrid}><div className={styles.playhead} />
                  {filteredTracks.map((track) => <div className={styles.trackRow} key={track.id}>
                    <div className={styles.trackIdentity}><span className={`${styles.trackIcon} ${styles[track.type]}`}>{track.type === 'narrator' ? <Mic2 size={18} /> : track.type === 'character' ? <UserRound size={18} /> : <Activity size={18} />}</span><span className={`${styles.trackName} ${styles[`${track.type}Text`]}`}>{track.label}<i /></span></div>
                    <div className={styles.trackLane}>{track.type === 'sfx' ? <div className={styles.missingSfx} style={{ left: `${track.left}%`, width: `${track.width}%` }}><span>⚠</span> {track.text} <small>Needs SFX</small></div> : <button className={`${styles.audioBlock} ${styles[track.type]}`} style={{ left: `${track.left}%`, width: `${track.width}%` }} onClick={() => openTrack(track)}><span className={styles.audioBlockTop}><span>{track.text}</span><small>{track.tone}</small></span><span className={styles.waveform}>{Array.from({ length: 64 }, (_, i) => <i key={i} style={{ height: `${15 + ((i * 17 + track.id * 13) % 72)}%` }} />)}</span></button>}</div>
                  </div>)}
                </div>
              </> : <div className={styles.timelineLoading}>{searchTerm ? 'No dialogue lines match your search.' : studioData?.status === 'failed' ? 'This chapter failed to process.' : 'No dialogue lines are present in this chapter blueprint yet.'}</div>}
            </div>
            <div className={styles.timelineBottom}><div><span className={styles.legend}><i className={styles.legendGreen} /> Narrator</span><span className={styles.legend}><i className={styles.legendBlue} /> Character</span><span className={styles.legend}><i className={styles.legendAmber} /> Sound cue</span></div><span className={styles.timelineDuration}>{statusLabel(studioData?.status)} <span>·</span> {studioData?.duration_seconds ? `${Math.round(studioData.duration_seconds)} sec` : 'duration pending'}</span></div>
            {studioData?.audio_url && <div className={styles.chapterAudio}><audio controls src={studioData.audio_url} /></div>}
          </section>
        </div></>}
        <nav className={styles.bottomNav}>{navItems.map(({ label, icon: Icon }) => <button key={label} className={nav === label ? styles.navActive : ''} onClick={() => { setNav(label); if (label === 'Home') setScreen('home'); else if (label === 'Projects') setScreen('projects'); else if (label === 'Settings') setScreen('settings'); }}><Icon size={21} strokeWidth={1.7} /><span>{label}</span></button>)}</nav>
      </>}
      {apiError && <div className={styles.apiError} role="alert"><span>{apiError}</span><button onClick={() => setApiError('')}>Dismiss</button></div>}
      <Dialog open={!!activeTrack} onOpenChange={(open) => { if (!open) setActiveTrack(null); }}>
        <DialogContent className={styles.voiceDialog}>
          <div className={styles.dialogBrand}><AudioLines size={22} /><span>Foley<span>Vox</span></span></div>
          <DialogHeader><DialogTitle>Edit Dialogue Line</DialogTitle><DialogDescription>Choose who speaks, how the line is delivered, and the words themselves.</DialogDescription></DialogHeader>
          <div className={styles.voiceField}><label>CHARACTER</label><Select value={editCharacter} onValueChange={setEditCharacter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Narrator', ...characters].map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></div>
          <div className={styles.voiceField}><label>TONE / EMOTION</label><Select value={editTone} onValueChange={setEditTone}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{toneOptions.map((tone) => <SelectItem key={tone} value={tone}>{tone}</SelectItem>)}</SelectContent></Select></div>
          <div className={styles.dialogueField}><label>Dialogue</label><Textarea value={dialogue} onChange={(event) => setDialogue(event.target.value)} rows={4} maxLength={500} /><div className={styles.charCount}>{dialogue.length} / 500</div></div>
          <DialogFooter><Button className={styles.saveButton} disabled={savingCharacter} onClick={saveDialogueLine}>{savingCharacter ? 'Saving…' : 'Save Line'}</Button><Button variant="secondary" className={styles.cancelButton} onClick={() => setActiveTrack(null)}>Cancel</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={onboardingOpen} onOpenChange={setOnboardingOpen}>
        <DialogContent className={styles.onboardingDialog}>
          <div className={styles.dialogBrand}><AudioLines size={22} /><span>Foley<span>Vox</span></span></div>
          <DialogHeader><DialogTitle>Let’s bring your book to life.</DialogTitle><DialogDescription>Your first project has three simple steps.</DialogDescription></DialogHeader>
          <div className={styles.onboardingSteps}>{[{title:'Upload your manuscript',detail:'Start with your story file. TXT and Markdown are ready to process.',icon:CloudUpload},{title:'Review your cast and voices',detail:'Open Characters to refine each role and choose its voice.',icon:UserRound},{title:'Render your chapters',detail:'Head to Studio and render chapters into audio.',icon:AudioLines}].map((step,index)=>{const Icon=step.icon;return <div className={onboardingStep===index?styles.onboardingStepActive:styles.onboardingStep} key={step.title}><span>{index+1}</span><Icon size={19}/><div><strong>{step.title}</strong><small>{step.detail}</small></div></div>})}</div>
          <DialogFooter><Button variant="outline" onClick={()=>setOnboardingOpen(false)}>Skip tour</Button><Button className={styles.saveButton} onClick={()=>{if(onboardingStep<2)setOnboardingStep((v)=>v+1);else setOnboardingOpen(false);}}>{onboardingStep===2?'Finish Tour': 'Next Step'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {toastMessage && <div className={styles.toastNotice} role="status"><Check size={16}/>{toastMessage}<button onClick={()=>setToastMessage('')} aria-label="Dismiss notification"><X size={14}/></button></div>}
    </main>
  );
}
