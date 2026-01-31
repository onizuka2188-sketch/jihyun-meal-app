import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Calendar, ChefHat, RefreshCw, Loader2, Key, Heart, Info, 
  AlertCircle, Printer, History, Settings, Save, Search, 
  BookOpen, Utensils, CheckCircle2, Database, WifiOff, ShieldCheck, BrainCircuit, Camera, Image as ImageIcon, Upload
} from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const getEnv = (key) => {
  const vKey = `VITE_${key.toUpperCase()}`;
  if (typeof window !== 'undefined' && window[vKey]) return window[vKey];
  try {
    const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
    return env[vKey] || null;
  } catch (e) { return null; }
};

const rawConfig = getEnv('FIREBASE_CONFIG');
let firebaseConfig = null;
try {
  if (rawConfig) {
    let cleaned = rawConfig.trim();
    if (cleaned.includes('{') && cleaned.includes('}')) {
      cleaned = cleaned.substring(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1);
    }
    const safeJson = cleaned.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":').replace(/'/g, '"');
    firebaseConfig = JSON.parse(safeJson);
  }
} catch (e) { }

const appId = getEnv('APP_ID') || 'jihyun-meal-ai-vision';

let app, auth, db;
if (firebaseConfig && firebaseConfig.apiKey) {
  try {
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);
    } else {
      app = getApps()[0];
      auth = getAuth(app);
      db = getFirestore(app);
    }
  } catch (e) { }
}

const App = () => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [visionLoading, setVisionLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); 
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [activeTab, setActiveTab] = useState('planner');
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const [userSettings, setUserSettings] = useState({ 
    geminiKey: "",
    learningData: "여기에 예전 식단표 정보가 누적됩니다. 사진을 분석하면 자동으로 내용이 추가됩니다." 
  });

  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) signInAnonymously(auth).catch(() => {});
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const historyRef = collection(db, 'artifacts', appId, 'public', 'data', 'meal_history');
    const unsubHistory = onSnapshot(historyRef, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setHistoryList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });
    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (d) => {
      if (d.exists()) setUserSettings(d.data());
    });
    return () => { unsubHistory(); unsubSettings(); };
  }, [user]);

  // 사진 분석 로직 (AI Vision)
  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const key = userSettings.geminiKey || getEnv('GEMINI_API_KEY') || "";
    if (!key) { setError("사진을 분석하려면 Gemini API 키가 필요합니다."); setActiveTab('settings'); return; }

    setVisionLoading(true);
    setError(null);

    try {
      // 사진을 Base64 문자열로 변환
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64Data = reader.result.split(',')[1];
        
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: "이 식단표 사진에서 모든 날짜와 메뉴 정보를 텍스트로 추출해줘. 불필요한 설명 없이 메뉴 리스트만 나열해줘." },
                { inlineData: { mimeType: file.type, data: base64Data } }
              ]
            }]
          })
        });

        const result = await res.json();
        const extractedText = result.candidates[0].content.parts[0].text;
        
        // 기존 학습 데이터에 추가
        setUserSettings(prev => ({
          ...prev,
          learningData: prev.learningData + "\n\n[추가된 식단 정보]:\n" + extractedText
        }));
        setVisionLoading(false);
        setSaveStatus('learning_success');
        setTimeout(() => setSaveStatus(null), 2000);
      };
    } catch (err) {
      setError("사진 분석 중 오류가 발생했습니다.");
      setVisionLoading(false);
    }
  };

  const generateWeeklyPlan = async () => {
    const key = userSettings.geminiKey || getEnv('GEMINI_API_KEY') || "";
    if (!key) { setError("Gemini API 키를 먼저 입력해 주세요."); setActiveTab('settings'); return; }
    
    setLoading(true); 
    setError(null);

    const prompt = `당신은 병원 전문 영양사입니다. 
    아래의 [참고 식단 데이터]의 패턴과 메뉴 스타일을 반영하여 '신도시이진병원' 스타일의 새로운 7일치 주간 식단표를 생성하세요.
    
    [참고 식단 데이터]:
    ${userSettings.learningData}
    
    반드시 JSON { "days": [] } 형식으로만 답변하세요.`;

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const result = await res.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      setWeeklyPlan(data.days);
      if (db && user) {
        addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'meal_history'), { plan: data.days, createdAt: serverTimestamp(), userId: user.uid }).catch(() => {});
      }
    } catch (err) { setError("식단 생성 실패."); } finally { setLoading(false); }
  };

  const renderCell = (items, isLunch = false) => (
    <div className="flex flex-col items-center justify-center py-2 min-h-[110px] leading-tight">
      {items.map((item, i) => (
        <span key={i} className={`text-[12px] md:text-[13px] ${isLunch && i === 2 ? 'font-black text-blue-700 underline' : 'text-slate-800 font-medium'}`}>{item}</span>
      ))}
    </div>
  );

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-white"><Loader2 className="animate-spin text-blue-600" size={40} /></div>;

  return (
    <div className="min-h-screen bg-slate-50 p-2 md:p-6 text-slate-900 print:bg-white print:p-0">
      <nav className="max-w-[1100px] mx-auto mb-8 flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-xl border border-white print:hidden">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-lg"><Heart className="text-white w-6 h-6 fill-current" /></div>
          <div><h1 className="text-xl font-black text-slate-800 tracking-tighter italic">지현이의 <span className="text-blue-600">영양 매니저</span></h1></div>
        </div>
        <div className="flex bg-slate-100 p-1.5 rounded-2xl gap-1">
          {['planner', 'history', 'settings'].map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${activeTab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>
              {t === 'planner' ? '식단표' : t === 'history' ? '히스토리' : '설정'}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-[1100px] mx-auto">
        {!db && activeTab === 'planner' && (
          <div className="mb-6 px-6 py-3 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black flex items-center gap-2 border border-blue-100 print:hidden uppercase tracking-widest"><Info size={14}/> Offline Mode Enabled</div>
        )}

        {activeTab === 'planner' && (
          <div className="space-y-6">
            <div className="flex justify-between items-end px-4 print:hidden">
              <h2 className="text-2xl font-black text-slate-800 tracking-tighter italic">신도시이진병원 식단표</h2>
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="bg-slate-800 text-white px-6 py-3 rounded-2xl font-black text-xs flex items-center gap-2 transition-all active:scale-95"><Printer size={16}/> 인쇄</button>
                <button onClick={generateWeeklyPlan} disabled={loading} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs flex items-center gap-2 shadow-lg disabled:opacity-50 transition-all active:scale-95">
                  {loading ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>} 식단 자동 생성
                </button>
              </div>
            </div>

            {weeklyPlan ? (
              <div className="bg-white border-[3px] border-slate-300 shadow-2xl overflow-x-auto rounded-xl">
                <table className="w-full min-w-[900px] border-collapse text-center table-fixed">
                  <thead><tr className="bg-slate-50 border-b-[3px] border-slate-300">
                    <th className="w-24 p-4 border-r-2 border-slate-200 text-[10px] font-black text-slate-400">구분</th>
                    {weeklyPlan.map((day, i) => <th key={i} className={`p-4 border-r-2 border-slate-200 text-[14px] font-black ${i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-slate-800'}`}>{day.date}</th>)}
                  </tr></thead>
                  <tbody className="divide-y-2 divide-slate-200">
                    <tr><td className="bg-slate-50 font-black text-[11px] text-slate-400 text-center">아침</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 align-top">{renderCell(day.breakfast)}</td>)}</tr>
                    <tr className="bg-blue-50/20 font-bold text-[12px] text-blue-800 text-center"><td colSpan="8" className="p-2.5 font-black">쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)</td></tr>
                    <tr><td className="bg-slate-50 font-black text-[11px] text-slate-400 text-center">점심</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 align-top">{renderCell(day.lunch, true)}</td>)}</tr>
                    <tr className="bg-blue-50/20 font-bold text-[12px] text-blue-800 text-center"><td colSpan="8" className="p-2.5 font-black">쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)</td></tr>
                    <tr><td className="bg-slate-50 font-black text-[11px] text-slate-400 text-center">저녁</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 align-top">{renderCell(day.dinner)}</td>)}</tr>
                    <tr className="bg-rose-50/30 font-black text-[12px] text-rose-600 italic text-center"><td className="bg-slate-50 font-black text-[10px] text-rose-400 text-center">간식</td>{weeklyPlan.map((day, i) => <td key={i} className="p-4 border-r-2 border-slate-200 font-black">{day.snack || "과일쥬스"}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            ) : <div className="bg-white p-24 rounded-[3.5rem] border-[4px] border-dashed border-slate-200 text-center space-y-4 shadow-inner"><ChefHat size={64} className="mx-auto text-slate-100"/><p className="font-black text-slate-300 uppercase tracking-widest">System Ready</p></div>}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto py-12 animate-in zoom-in">
            <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 relative">
              {saveStatus === 'learning_success' && <div className="absolute inset-0 bg-blue-600 flex flex-col items-center justify-center text-white z-20 font-black text-2xl animate-in fade-in duration-300 px-8 text-center"><CheckCircle2 size={48} className="mb-4 animate-bounce"/>사진 분석 및 학습 완료!</div>}
              {saveStatus === 'success' && <div className="absolute inset-0 bg-blue-600 flex items-center justify-center text-white z-20 font-black text-2xl animate-in fade-in duration-300">설정 저장 완료!</div>}
              
              <div className="flex items-center gap-4 mb-8"><div className="bg-blue-600 p-4 rounded-2xl shadow-lg"><BrainCircuit className="text-white" size={24}/></div><h3 className="text-2xl font-black text-slate-800 italic tracking-tighter">AI 지능 학습 및 설정</h3></div>
              
              <div className="space-y-10">
                {/* 1. API 키 설정 */}
                <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100">
                  <label className="block text-[11px] font-black text-slate-400 mb-3 uppercase px-1">Gemini API Key</label>
                  <input type="password" value={userSettings.geminiKey} onChange={(e) => setUserSettings({...userSettings, geminiKey: e.target.value})} placeholder="API 키를 입력하세요" className="w-full px-8 py-5 rounded-3xl bg-white border-none font-bold shadow-sm outline-none text-sm focus:ring-2 focus:ring-blue-500" />
                </div>

                {/* 2. 사진 학습 (새로운 기능!) */}
                <div className="p-8 bg-blue-50/50 rounded-[2.5rem] border-2 border-dashed border-blue-200">
                  <div className="flex justify-between items-center mb-6">
                    <div><h4 className="font-black text-blue-700 text-lg tracking-tighter italic">식단표 사진으로 학습하기</h4><p className="text-[10px] text-blue-400 font-bold mt-1 uppercase">AI Visual Learning</p></div>
                    <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-100"><Camera className="text-white" size={20}/></div>
                  </div>
                  
                  <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
                  
                  <button 
                    onClick={() => fileInputRef.current.click()} 
                    disabled={visionLoading}
                    className="w-full py-10 bg-white border-2 border-dashed border-blue-200 rounded-[2rem] flex flex-col items-center justify-center gap-4 hover:bg-blue-50 transition-all group"
                  >
                    {visionLoading ? (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="animate-spin text-blue-600" size={32} />
                        <p className="text-xs font-black text-blue-600 animate-pulse">AI가 사진을 분석 중입니다...</p>
                      </div>
                    ) : (
                      <>
                        <div className="bg-blue-100 p-4 rounded-full group-hover:scale-110 transition-transform"><Upload className="text-blue-600" size={24}/></div>
                        <p className="text-sm font-black text-slate-500">이곳을 클릭하여 <span className="text-blue-600">식단표 사진</span>을 선택하세요</p>
                      </>
                    )}
                  </button>
                </div>

                {/* 3. 누적 학습 데이터 */}
                <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100">
                  <label className="block text-[11px] font-black text-slate-400 mb-3 uppercase px-1 tracking-widest">누적 학습 데이터 (패턴 분석용)</label>
                  <textarea value={userSettings.learningData} onChange={(e) => setUserSettings({...userSettings, learningData: e.target.value})} className="w-full px-8 py-6 rounded-3xl bg-white border-none font-bold shadow-sm outline-none text-xs h-40 resize-none leading-relaxed" />
                  <p className="mt-3 text-[10px] text-slate-400 font-bold px-1 italic">※ 사진을 분석할 때마다 여기에 정보가 쌓입니다. 정보가 많을수록 결과가 정확해집니다.</p>
                </div>

                <button onClick={() => { if(db && user) { setLoading(true); setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config'), userSettings, { merge: true }).then(() => { setSaveStatus('success'); setTimeout(() => { setSaveStatus(null); setActiveTab('planner'); }, 1500); }).finally(() => setLoading(false)); } else { setSaveStatus('success'); setTimeout(() => { setSaveStatus(null); setActiveTab('planner'); }, 1500); } }} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black shadow-xl transition-all hover:bg-black active:scale-95 flex items-center justify-center gap-2">
                  <Save size={18}/> 설정 및 학습 데이터 저장
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <footer className="mt-20 py-16 text-center opacity-30 text-[10px] font-black border-t border-slate-200 max-w-[1100px] mx-auto print:hidden uppercase tracking-[0.5em]">Jihyun's AI Nutrition Manager</footer>
    </div>
  );
};

export default App;