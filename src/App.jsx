import React, { useState, useEffect } from 'react';
import { Calendar, ChefHat, RefreshCw, Loader2, Key, Heart, Info, AlertCircle, Printer } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// --- 환경 변수 설정 ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'jihyun-hospital-app';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let app, auth, db;
if (firebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const App = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('planner');
  const [userSettings, setUserSettings] = useState({ geminiKey: "" });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);
        else await signInAnonymously(auth);
      } catch (err) { console.error("인증 실패"); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const historyRef = collection(db, 'artifacts', appId, 'public', 'data', 'meal_history');
    const unsubHistory = onSnapshot(historyRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistory(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });
    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) setUserSettings(docSnap.data());
    });
    return () => { unsubHistory(); unsubSettings(); };
  }, [user]);

  const generateWeeklyPlan = async () => {
    const key = userSettings.geminiKey || (typeof apiKey !== 'undefined' ? apiKey : "");
    if (!key) { setError("설정 탭에서 API 키를 먼저 입력해 주세요."); setActiveTab('settings'); return; }
    setLoading(true); setError(null);
    const systemPrompt = `병원 영양사용 식단 AI입니다. JSON으로 답변하세요: { "days": [ { "date": "1/12(월)", "breakfast": ["현미밥", "미역국", "불고기", "나물", "김치"], "lunch": [...], "dinner": [...], "snack": "사과주스" } ] }`;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "병원 주간 식단표를 짜줘." }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const result = await res.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      setWeeklyPlan(data.days);
      if (db && user) await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'meal_history'), { plan: data.days, createdAt: serverTimestamp(), userId: user.uid });
    } catch (err) { setError("식단 생성에 실패했습니다."); } finally { setLoading(false); }
  };

  const renderCell = (items, isLunch = false) => (
    <div className="flex flex-col items-center justify-center py-2 min-h-[120px] leading-tight print:min-h-0 print:py-1">
      {items.map((item, i) => (
        <span key={i} className={`text-[12px] md:text-[13px] ${isLunch && i === 2 ? 'font-black text-blue-700 underline' : 'text-slate-800'}`}>
          {item}
        </span>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-2 md:p-6 text-slate-900 print:bg-white print:p-0">
      <nav className="max-w-[1100px] mx-auto mb-8 flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-xl shadow-slate-200/50 border border-white print:hidden">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200 flex items-center justify-center">
            <Heart className="text-white w-6 h-6 fill-current" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight leading-none">지현이의 <span className="text-blue-600 font-black">영양 매니저</span></h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5">Premium Hospital Meal System</p>
          </div>
        </div>
        <div className="flex bg-slate-100 p-1.5 rounded-2xl gap-1">
          {['planner', 'history', 'settings'].map(t => (
            <button 
              key={t} 
              onClick={() => setActiveTab(t)} 
              className={`px-8 py-2.5 rounded-xl text-xs font-black transition-all duration-300 ${activeTab === t ? 'bg-white text-blue-600 shadow-sm scale-100' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
            >
              {t === 'planner' ? '식단표' : t === 'history' ? '히스토리' : '설정'}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-[1100px] mx-auto">
        {activeTab === 'planner' && (
          <div className="space-y-6 animate-in fade-in duration-700">
            <div className="flex justify-between items-end px-4 print:hidden">
              <div>
                <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2 tracking-tighter">
                  <Calendar className="text-blue-600" size={24}/> 신도시이진병원 식단표
                </h2>
                <p className="text-slate-400 text-[10px] font-black mt-1.5 tracking-wider uppercase italic">Weekly Patient Meal Plan</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="bg-slate-800 hover:bg-black text-white px-6 py-3 rounded-2xl font-black text-xs shadow-lg transition-all active:scale-95 flex items-center gap-2">
                  <Printer size={16}/> 인쇄 / PDF 저장
                </button>
                <button onClick={generateWeeklyPlan} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-black text-xs shadow-lg transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2">
                  {loading ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>} 식단 자동 생성
                </button>
              </div>
            </div>

            {weeklyPlan ? (
              <div className="bg-white border-[3px] border-slate-300 shadow-2xl overflow-x-auto rounded-xl print:border-slate-800 print:shadow-none">
                <table className="w-full min-w-[900px] border-collapse text-center table-fixed">
                  <thead>
                    <tr className="bg-slate-50 border-b-[3px] border-slate-300 print:bg-white print:border-b-2">
                      <th className="w-24 p-4 border-r-2 border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">구분</th>
                      {weeklyPlan.map((day, i) => (
                        <th key={i} className={`p-4 border-r-2 border-slate-200 last:border-r-0 text-[14px] font-black ${i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-slate-800'}`}>
                          {day.date}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-slate-200">
                    <tr>
                      <td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400 print:text-black">아침</td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.breakfast)}</td>)}
                    </tr>
                    <tr className="bg-blue-50/20 print:bg-white">
                      <td className="border-r-2 border-slate-200 font-bold text-[10px] text-blue-400 italic">粥</td>
                      <td colSpan="7" className="p-2.5 text-[12px] font-bold text-blue-800 tracking-widest print:text-black print:border-y-2">
                        쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)
                      </td>
                    </tr>
                    <tr>
                      <td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400 print:text-black">점심</td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.lunch, true)}</td>)}
                    </tr>
                    <tr className="bg-blue-50/20 print:bg-white">
                      <td className="border-r-2 border-slate-200 font-bold text-[10px] text-blue-400 italic">粥</td>
                      <td colSpan="7" className="p-2.5 text-[12px] font-bold text-blue-800 tracking-widest print:text-black print:border-y-2">
                        쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)
                      </td>
                    </tr>
                    <tr>
                      <td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400 print:text-black">저녁</td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.dinner)}</td>)}
                    </tr>
                    <tr className="bg-rose-50/30 print:bg-white">
                      <td className="border-r-2 border-slate-200 font-bold text-[10px] text-rose-400 italic">간식</td>
                      {weeklyPlan.map((day, i) => (
                        <td key={i} className="p-4 border-r-2 border-slate-200 last:border-r-0 text-[12px] font-black text-rose-600 italic">
                          {day.snack || "과일쥬스"}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-white p-24 rounded-[3.5rem] border-[4px] border-dashed border-slate-200 text-center space-y-6 animate-in zoom-in-95 duration-1000 print:hidden">
                <ChefHat size={64} className="mx-auto text-slate-200" />
                <div className="space-y-1">
                  <p className="font-black text-slate-300 text-2xl italic tracking-tighter uppercase">Hospital Diet System Access Ready</p>
                  <p className="text-blue-500 font-bold text-sm tracking-tight">오른쪽 상단 '식단 자동 생성' 버튼을 눌러주세요!</p>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;