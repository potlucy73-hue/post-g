import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  LayoutDashboard, Settings, ListTodo, Activity, PlayCircle, 
  PauseCircle, Trash2, CheckCircle, ChevronLeft, Menu,
  Globe, KeyRound, Type, Clock, Plus, Server, X
} from 'lucide-react';

// --- SYSTEM PROMPT (Same as before) ---
const SYSTEM_PROMPT = `
You are a professional recipe blogger API. 
You must output a VALID JSON object for the given recipe title.
Do NOT write any introduction, markdown code blocks (like \`\`\`json), or comments. Just the raw JSON object.
The JSON structure must be exactly like this:
{
  "title": "Recipe Title Here",
  "prep_time": "15", 
  "cook_time": "20",
  "servings": "4",
  "categories": [1], 
  "ingredients": [
    { "name": "Main Ingredients", "items": ["1 cup flour", "2 eggs"] }
  ],
  "instructions": [
    { "name": "Preparation", "steps": ["Mix flour and eggs", "Bake at 350F"] }
  ],
  "article": "<p>Write a long, engaging, SEO-optimized blog post introduction here (approx 300 words)...</p><h2>Why you will love this recipe</h2><p>Details...</p><h2>Tips for Success</h2><ul><li>Tip 1</li><li>Tip 2</li></ul>"
}
Rules:
1. "article" must contain proper HTML tags (p, h2, strong, ul, li). 
2. The article should be at least 800 words long.
3. Do not include the recipe card in the "article" field.
`;

// --- DATABASE KEYS (localStorage) ---
const DB_KEYS = {
  WEBSITES: 'cs_websites_v6',
  GEMINI_KEYS: 'cs_geminiKeys_v6',
  KEYWORDS: 'cs_keywords_v6',
  SCHEDULES: 'cs_schedules_v6',
  STATS: 'cs_stats_v6'
};

// --- PRE-LOADED DATA (Tumhari details) ---
const PRELOADED_SITE_ID = 'site_flavorzing_preload';

const PRELOADED_WEBSITES = [
  {
    id: PRELOADED_SITE_ID,
    name: 'FlavorZing (Preloaded)',
    url: 'https://flavorzing.com',
    user: 'hh',
    pass: 'Y1zI8Qm58IRF q10V16GloCpo' 
  }
];

const PRELOADED_KEYS = [
  'AIzaSyBHUXFhDHf_j2_-PRWizrEoz1bm6-2i_yU' 
];

const PRELOADED_SCHEDULES = [
  {
    id: 'sch_flavorzing_preload',
    siteId: PRELOADED_SITE_ID,
    postsPerDay: 5, // Default 5 par set hai, tum change kar lena
    isRunning: false // Shuru mein Paused hai
  }
];


// --- Custom Hook for localStorage ---
function usePersistentState(key, defaultValue) {
  const [state, setState] = useState(() => {
    const storedValue = localStorage.getItem(key);
    // Agar pehle se save hai to wo use karo, warna default (preloaded)
    return storedValue ? JSON.parse(storedValue) : defaultValue;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  return [state, setState];
}

const App = () => {
  const [activeView, setActiveView] = useState('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  
  // --- New Multi-Config State (Defaults ab preloaded hain) ---
  const [websites, setWebsites] = usePersistentState(DB_KEYS.WEBSITES, PRELOADED_WEBSITES);
  const [geminiKeys, setGeminiKeys] = usePersistentState(DB_KEYS.GEMINI_KEYS, PRELOADED_KEYS);
  const [keywords, setKeywords] = usePersistentState(DB_KEYS.KEYWORDS, []);
  const [schedules, setSchedules] = usePersistentState(DB_KEYS.SCHEDULES, PRELOADED_SCHEDULES);
  const [stats, setStats] = usePersistentState(DB_KEYS.STATS, {}); // { 'siteId_2025-11-14': 5 }

  const [logs, setLogs] = useState([]);
  const logContainerRef = useRef(null);
  
  const currentKeyIndex = useRef(0);

  useEffect(() => {
    addLog('System Ready. FlavorZing & API Key pre-loaded.', 'system');
  }, []);

  useEffect(() => {
    if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [logs]);

  const addLog = (msg, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{ id: Date.now(), time: timestamp, msg, type }, ...prev.slice(0, 199)]);
  };

  // --- JSON Cleaner ---
  const cleanAndParseJSON = (text) => {
    try {
      return JSON.parse(text);
    } catch (e1) {
      try {
        let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
      } catch (e2) {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error("Invalid JSON format");
      }
    }
  };

  // 1. GENERATE CONTENT (with API Failover)
  const generateRecipeContent = async (title, attempt = 0) => {
    if (geminiKeys.length === 0) throw new Error("No Gemini API Keys configured.");
    if (attempt >= geminiKeys.length) throw new Error("All Gemini API keys failed.");

    const key = geminiKeys[currentKeyIndex.current];
    addLog(`Generating content for: ${title} (Using Key ${currentKeyIndex.current + 1})`, 'info');
    
    const model = 'gemini-2.5-flash-preview-09-2025';
    
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate a recipe JSON for: "${title}"` }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      
      const data = await res.json();
      
      if (data.error) {
          if (data.error.code === 429) throw new Error("Rate Limit Exceeded");
          throw new Error(data.error.message || "Model Error");
      }
      
      if (!data.candidates?.[0]?.content) throw new Error("Safety Block or Empty Response");
      
      const jsonText = data.candidates[0].content.parts[0].text;
      return cleanAndParseJSON(jsonText);
      
    } catch (e) {
      addLog(`API Key ${currentKeyIndex.current + 1} failed: ${e.message}. Switching key...`, 'error');
      currentKeyIndex.current = (currentKeyIndex.current + 1) % geminiKeys.length;
      return generateRecipeContent(title, attempt + 1);
    }
  };

  // 2. IMAGE HANDLER (Ab ye config leta hai)
  const handleImages = async (query, siteConfig) => {
    addLog(`Searching images for: ${query}...`, 'info');
    // Google Search API keys abhi bhi hardcoded hain
    const GOOGLE_API_KEY = 'AIzaSyDMfAv6gP6Uzldn68Y-LKLLTzS1tx5n1TU';     
    const SEARCH_ENGINE_ID = '35d066ed52c084df9';   

    try {
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&cx=${SEARCH_ENGINE_ID}&searchType=image&key=${GOOGLE_API_KEY}&num=4&safe=active`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.items) return { featuredId: null, bodyUrls: [] };

        const uploadPromises = data.items.map(async (item) => {
            try {
                const imgRes = await fetch(item.link);
                if (!imgRes.ok) return null;
                const blob = await imgRes.blob();
                const filename = `img_${Date.now()}.jpg`;
                const formData = new FormData();
                formData.append('file', blob, filename);

                const wpRes = await fetch(`${siteConfig.url}/wp-json/wp/v2/media`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${btoa(`${siteConfig.user}:${siteConfig.pass}`)}`,
                        'Content-Disposition': `attachment; filename=${filename}`
                    },
                    body: formData
                });
                const wpData = await wpRes.json();
                return wpData.id ? { id: wpData.id, url: wpData.source_url } : null;
            } catch (e) { return null; }
        });

        const results = (await Promise.all(uploadPromises)).filter(r => r !== null);
        if (results.length === 0) return { featuredId: null, bodyUrls: [] };
        
        return { featuredId: results[0].id, bodyUrls: results.slice(1).map(r => r.url) };
    } catch (e) {
        addLog(`Image Error: ${e.message}.`, 'warning');
        return { featuredId: null, bodyUrls: [] };
    }
  };
  
  // 3. WPRM (Ab ye config leta hai)
  const createWprmRecipe = async (recipeData, imageId, siteConfig) => {
    addLog('Creating Recipe Card...', 'info');
    try {
        const payload = {
            recipe: {
                name: recipeData.title, author: siteConfig.name || "Alina",
                summary: `Learn how to make ${recipeData.title} at home.`,
                servings: recipeData.servings, prep_time: recipeData.prep_time,
                cook_time: recipeData.cook_time,
                total_time: (parseInt(recipeData.prep_time||0)+parseInt(recipeData.cook_time||0)).toString(),
                ingredients: recipeData.ingredients.map(s => ({ name: s.name, ingredients: s.items.map(i => ({ raw: i })) })),
                instructions: recipeData.instructions.map(s => ({ name: s.name, instructions: s.steps.map(i => ({ text: i })) }))
            }
        };
        if (imageId) payload.recipe.image_id = imageId;

        const res = await fetch(`${siteConfig.url}/wp-json/wp/v2/wprm_recipe`, {
            method: 'POST', 
            headers: { 'Authorization': `Basic ${btoa(`${siteConfig.user}:${siteConfig.pass}`)}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.id) return data.id;
        return null; 
    } catch (e) {
        addLog('WPRM failed. Continuing without card.', 'warning');
        return null;
    }
  };

  // 4. POST (Ab ye config leta hai)
  const createPost = async (recipeData, recipeId, featuredId, imageUrls, siteConfig) => {
    addLog(`Publishing to ${siteConfig.name}...`, 'info');
    let content = recipeData.article;
    
    if (imageUrls.length > 0) {
        const parts = content.split('</p>');
        content = ''; let imgIndex = 0;
        parts.forEach((p, i) => {
            if (!p.trim()) return;
            content += p + '</p>';
            if ((i + 1) % 3 === 0 && imgIndex < imageUrls.length) {
                content += `<div class="wp-block-image"><figure class="aligncenter"><img src="${imageUrls[imgIndex]}" alt="${recipeData.title} step" /></figure></div>`;
                imgIndex++;
            }
        });
    }

    if (recipeId) content += `\n\n[wprm-recipe id="${recipeId}"]`;

    const res = await fetch(`${siteConfig.url}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${btoa(`${siteConfig.user}:${siteConfig.pass}`)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: recipeData.title,
            content: content,
            status: 'draft',
            categories: recipeData.categories || [1],
            featured_media: featuredId
        })
    });
    
    const data = await res.json();
    if (!data.id) throw new Error(data.message || "Post failed");
    return data.link;
  };

  // --- Main Processing Function (Ye ab scheduler use karega) ---
  const processSingleKeyword = async (keyword) => {
    setKeywords(prev => prev.map(k => k.id === keyword.id ? { ...k, status: 'processing' } : k));
    
    const siteConfig = websites.find(w => w.id === keyword.siteId);
    if (!siteConfig) {
        addLog(`Config for siteID ${keyword.siteId} not found. Skipping.`, 'error');
        setKeywords(prev => prev.map(k => k.id === keyword.id ? { ...k, status: 'failed', error: 'Site config missing' } : k));
        return;
    }

    try {
        const recipeData = await generateRecipeContent(keyword.text);
        const { featuredId, bodyUrls } = await handleImages(keyword.text + " recipe", siteConfig);
        const wprmId = await createWprmRecipe(recipeData, featuredId, siteConfig);
        const link = await createPost(recipeData, wprmId, featuredId, bodyUrls, siteConfig);

        setKeywords(prev => prev.map(k => k.id === keyword.id ? { ...k, status: 'completed', link: link } : k));
        addLog(`Published: ${keyword.text} to ${siteConfig.name}`, 'success');
        
        const today = new Date().toISOString().split('T')[0];
        const statKey = `${siteConfig.id}_${today}`;
        setStats(prev => ({
            ...prev,
            [statKey]: (prev[statKey] || 0) + 1
        }));

    } catch (e) {
        setKeywords(prev => prev.map(k => k.id === keyword.id ? { ...k, status: 'failed', error: e.message } : k));
        addLog(`Failed ${keyword.text}: ${e.message}`, 'error');
    }
  };

  // --- SCHEDULER LOGIC ---
  const runScheduler = useCallback(async () => {
    addLog('Scheduler checking for tasks...', 'system');
    const today = new Date().toISOString().split('T')[0];

    for (const schedule of schedules) {
        const siteConfig = websites.find(w => w.id === schedule.siteId);
        if (!siteConfig || !schedule.isRunning) continue;

        const statKey = `${siteConfig.id}_${today}`;
        const postsMadeToday = stats[statKey] || 0;
        
        if (postsMadeToday >= schedule.postsPerDay) {
            addLog(`Site ${siteConfig.name} daily quota (${schedule.postsPerDay}) reached.`, 'info');
            continue;
        }

        const isProcessing = keywords.some(k => k.status === 'processing');
        if (isProcessing) {
             addLog('Another task is already processing. Waiting...', 'info');
             return; 
        }

        const keywordToProcess = keywords.find(k => k.siteId === schedule.siteId && k.status === 'pending');

        if (keywordToProcess) {
            addLog(`Quota not met for ${siteConfig.name}. Processing keyword: ${keywordToProcess.text}`, 'info');
            await processSingleKeyword(keywordToProcess);
            break; 
        } else {
            addLog(`No pending keywords found for ${siteConfig.name}.`, 'info');
        }
    }
  }, [schedules, keywords, websites, stats]); // Dependencies

  // --- Scheduler Interval ---
  useEffect(() => {
    let interval;
    if (isRunning) {
        addLog('System Started. Scheduler is active.', 'success');
        interval = setInterval(runScheduler, 5 * 60 * 1000); // Har 5 minute
        runScheduler(); 
    } else {
        addLog('System Stopped. Scheduler is paused.', 'system');
    }
    return () => clearInterval(interval);
  }, [isRunning, runScheduler]);


  // --- All Page Components ---

  const DashboardPage = () => {
    const totalKeywords = keywords.length;
    const pending = keywords.filter(k => k.status === 'pending').length;
    const completed = keywords.filter(k => k.status === 'completed').length;
    const failed = keywords.filter(k => k.status === 'failed').length;

    return (
        <div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-slate-800 p-4 rounded border border-slate-700 shadow-lg"><h3>Total Keywords</h3><p className="text-3xl font-bold mt-2">{totalKeywords}</p></div>
                <div className="bg-slate-800 p-4 rounded border border-slate-700 shadow-lg"><h3>Pending</h3><p className="text-3xl font-bold mt-2 text-yellow-400">{pending}</p></div>
                <div className="bg-slate-800 p-4 rounded border border-slate-700 shadow-lg"><h3>Completed</h3><p className="text-3xl font-bold mt-2 text-green-400">{completed}</p></div>
                <div className="bg-slate-800 p-4 rounded border border-slate-700 shadow-lg"><h3>Failed</h3><p className="text-3xl font-bold mt-2 text-red-400">{failed}</p></div>
            </div>
            <div className="bg-slate-800 p-6 rounded border border-slate-700 shadow-xl">
                <h3 className="font-bold mb-4 text-xl text-green-400">Welcome to ContentStack OS</h3>
                <p className="text-slate-400 text-sm mb-4">
                    Tumhari 'FlavorZing' site aur API key pehle se loaded hain.
                    1. Seedha "Keywords" tab me jao aur titles add karo.
                    2. Phir "Scheduler" tab me daily post limit set karke "Run" dabao.
                    3. Jab sab set ho jaye, to sidebar me "Start System" ka button daba do.
                </p>
                <div className="bg-slate-900 rounded p-4 border border-slate-700">
                    <h4 className="font-bold mb-2">Today's Stats</h4>
                    <ul className="text-sm">
                        {websites.map(w => {
                            const today = new Date().toISOString().split('T')[0];
                            const statKey = `${w.id}_${today}`;
                            const postsToday = stats[statKey] || 0;
                            const schedule = schedules.find(s => s.siteId === w.id);
                            const dailyLimit = schedule ? schedule.postsPerDay : 0;
                            return (
                                <li key={w.id} className="flex justify-between items-center mb-1">
                                    <span className="text-slate-300">{w.name}</span>
                                    <span className={`font-bold ${postsToday >= dailyLimit ? 'text-green-400' : 'text-yellow-400'}`}>
                                        {postsToday} / {dailyLimit} Posts
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </div>
    );
  };

  const WebsitesPage = () => {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [user, setUser] = useState('');
    const [pass, setPass] = useState('');

    const handleAdd = () => {
        if (!name || !url || !user || !pass) {
            addLog('All website fields are required.', 'error'); return;
        }
        const newSite = { id: `site_${Date.now()}`, name, url, user, pass };
        setWebsites(prev => [...prev, newSite]);
        setSchedules(prev => [...prev, { id: `sch_${Date.now()}`, siteId: newSite.id, postsPerDay: 0, isRunning: false }]);
        addLog(`Website added: ${name}`, 'success');
        setName(''); setUrl(''); setUser(''); setPass('');
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 bg-slate-800 p-6 rounded border border-slate-700 shadow-xl">
                <h3 className="font-bold mb-4 text-xl text-green-400">Add New Website</h3>
                <div className="space-y-4">
                    <input value={name} onChange={e=>setName(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2" placeholder="Site Name (e.g. Roblox Site)" />
                    <input value={url} onChange={e=>setUrl(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2" placeholder="WordPress URL (https://...)" />
                    <input value={user} onChange={e=>setUser(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2" placeholder="WP Username" />
                    <input value={pass} onChange={e=>setPass(e.target.value)} type="password" className="w-full bg-slate-900 border border-slate-600 rounded p-2" placeholder="WP Application Password" />
                    <button onClick={handleAdd} className="bg-green-600 text-white font-bold py-2 px-4 rounded w-full">Add Site</button>
                </div>
            </div>
            <div className="md:col-span-2 bg-slate-800 rounded border border-slate-700 shadow-xl">
                <h3 className="font-bold mb-4 text-xl p-6 border-b border-slate-700">Managed Websites</h3>
                <div className="divide-y divide-slate-700">
                    {websites.length === 0 && <p className="p-6 text-slate-500">No websites added yet.</p>}
                    {websites.map(w => (
                        <div key={w.id} className="p-6 flex justify-between items-center">
                            <div>
                                <h4 className="font-bold text-lg">{w.name}</h4>
                                <p className="text-sm text-slate-400">{w.url}</p>
                            </div>
                            <button onClick={() => {
                                setWebsites(prev => prev.filter(site => site.id !== w.id));
                                setSchedules(prev => prev.filter(s => s.siteId !== w.id));
                                setKeywords(prev => prev.filter(k => k.siteId !== w.id));
                                addLog(`Site ${w.name} removed.`, 'system');
                            }} className="text-red-400 p-2 hover:bg-red-900/20 rounded"><Trash2 size={20}/></button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
  };

  const ApiKeysPage = () => {
    const [key, setKey] = useState('');
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 bg-slate-800 p-6 rounded border border-slate-700 shadow-xl">
                <h3 className="font-bold mb-4 text-xl text-green-400">Add Gemini API Key</h3>
                <input value={key} onChange={e=>setKey(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 mb-4" placeholder="AIza..." />
                <button onClick={() => {
                    if (!key) return;
                    setGeminiKeys(prev => [...prev, key]);
                    addLog('API Key added.', 'success');
                    setKey('');
                }} className="bg-green-600 text-white font-bold py-2 px-4 rounded w-full">Add Key</button>
            </div>
            <div className="md:col-span-2 bg-slate-800 rounded border border-slate-700 shadow-xl">
                <h3 className="font-bold mb-4 text-xl p-6 border-b border-slate-700">API Key Pool</h3>
                <div className="divide-y divide-slate-700">
                    {geminiKeys.length === 0 && <p className="p-6 text-slate-500">No keys added. System is offline.</p>}
                    {geminiKeys.map((k, index) => (
                        <div key={index} className="p-6 flex justify-between items-center font-mono text-sm">
                            <span className="text-slate-300">Key {index + 1}: {k.substring(0, 4)}...{k.substring(k.length - 4)}</span>
                            <button onClick={() => {
                                setGeminiKeys(prev => prev.filter((_, i) => i !== index));
                                addLog('API Key removed.', 'system');
                            }} className="text-red-400 p-2 hover:bg-red-900/20 rounded"><Trash2 size={20}/></button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
  };

  const KeywordsPage = () => {
    const [selectedSite, setSelectedSite] = useState(websites[0]?.id || '');
    const [bulkInput, setBulkInput] = useState('');

    const handleAdd = () => {
        if (!selectedSite || !bulkInput.trim()) {
            addLog('Please select a site and enter keywords.', 'error'); return;
        }
        const lines = bulkInput.split('\n').filter(l => l.trim());
        const newKeywords = lines.map(line => ({
            id: `kw_${Date.now()}_${Math.random()}`,
            text: line.trim(),
            siteId: selectedSite,
            status: 'pending'
        }));
        setKeywords(prev => [...prev, ...newKeywords]);
        addLog(`${newKeywords.length} keywords added for ${websites.find(w=>w.id===selectedSite)?.name}.`, 'success');
        setBulkInput('');
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-1 bg-slate-800 p-6 rounded border border-slate-700 shadow-xl">
                <h3 className="font-bold mb-4 text-xl text-green-400">Add Keywords</h3>
                <select value={selectedSite} onChange={e=>setSelectedSite(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 mb-4">
                    <option value="">Select Website...</option>
                    {websites.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <textarea value={bulkInput} onChange={e=>setBulkInput(e.target.value)} className="w-full h-48 bg-slate-900 border border-slate-600 rounded p-2 mb-4" placeholder="One keyword per line..."></textarea>
                <button onClick={handleAdd} className="bg-green-600 text-white font-bold py-2 px-4 rounded w-full">Add Keywords</button>
            </div>
            <div className="md:col-span-2 bg-slate-800 rounded border border-slate-700 shadow-xl">
                <h3 className="font-bold mb-4 text-xl p-6 border-b border-slate-700">All Pending Keywords</h3>
                <div className="divide-y divide-slate-700 max-h-[60vh] overflow-y-auto">
                    {keywords.filter(k=>k.status==='pending').length === 0 && <p className="p-6 text-slate-500">No pending keywords.</p>}
                    {keywords.filter(k=>k.status === 'pending').map(k => {
                        const site = websites.find(w => w.id === k.siteId);
                        return (
                            <div key={k.id} className="p-4 flex justify-between items-center text-sm">
                                <div>
                                    <p className="text-slate-200">{k.text}</p>
                                    <p className="text-xs text-blue-400">{site ? site.name : 'Unassigned'}</p>
                                </div>
                                <button onClick={() => setKeywords(prev => prev.filter(kw => kw.id !== k.id))} className="text-red-400 p-2 hover:bg-red-900/20 rounded"><Trash2 size={16}/></button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
  };
  
  const SchedulerPage = () => {
    
    const handleLimitChange = (siteId, value) => {
        const num = parseInt(value) || 0;
        setSchedules(prev => prev.map(s => s.siteId === siteId ? { ...s, postsPerDay: num } : s));
    };

    const handleToggle = (siteId, isRunning) => {
        setSchedules(prev => prev.map(s => s.siteId === siteId ? { ...s, isRunning: isRunning } : s));
        const siteName = websites.find(w=>w.id===siteId)?.name;
        addLog(`Scheduler for ${siteName} ${isRunning ? 'ACTIVATED' : 'PAUSED'}.`, 'system');
    };

    return (
        <div className="max-w-4xl mx-auto">
            <div className="bg-slate-800 p-6 rounded border border-slate-700 shadow-xl mb-6">
                <h3 className="font-bold mb-4 text-xl text-green-400">Scheduler Control</h3>
                <p className="text-sm text-slate-400 mb-4">
                    Yahan har website ke liye daily post limit set karo.
                    System tabhi chalega jab main "Start System" toggle (sidebar mein) ON hoga.
                </p>
            </div>

            <div className="space-y-4">
                {websites.length === 0 && <p className="text-slate-500 text-center">Pehle "Websites" tab me ja kar site add karo.</p>}
                {websites.map(w => {
                    const schedule = schedules.find(s => s.siteId === w.id);
                    if (!schedule) return null;
                    return (
                        <div key={w.id} className="bg-slate-800 p-6 rounded border border-slate-700 shadow-lg flex items-center justify-between">
                            <div>
                                <h4 className="font-bold text-lg text-white">{w.name}</h4>
                                <p className="text-sm text-slate-400">{w.url}</p>
                            </div>
                            <div className="flex items-center gap-4">
                                <span className="text-sm text-slate-400">Posts per Day:</span>
                                <input 
                                    type="number" 
                                    min="0"
                                    value={schedule.postsPerDay}
                                    onChange={e => handleLimitChange(w.id, e.target.value)}
                                    className="w-20 bg-slate-900 border border-slate-600 rounded p-2 text-center"
                                />
                                <button 
                                    onClick={() => handleToggle(w.id, !schedule.isRunning)}
                                    className={`px-4 py-2 rounded font-bold ${schedule.isRunning ? 'bg-red-500/80' : 'bg-green-600'}`}
                                >
                                    {schedule.isRunning ? 'Pause' : 'Run'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
  };
  
  const LogsPage = () => (
    <div className="bg-black text-green-400 font-mono text-xs p-4 rounded border border-slate-700 h-[75vh] overflow-auto shadow-inner" ref={logContainerRef}>
        {logs.length === 0 && <div className="opacity-50">Waiting for logs...</div>}
        {logs.map(l => (
            <div key={l.id} className={`mb-1 pb-1 border-b border-slate-800
                ${l.type === 'error' ? 'text-red-400' : l.type === 'success' ? 'text-green-300' : l.type === 'system' ? 'text-blue-300' : 'text-slate-400'}
            `}>
                <span className="opacity-50 mr-2">[{l.time}]</span> {l.msg}
            </div>
        ))}
    </div>
  );

  // --- Main Render ---
  const renderView = () => {
    switch(activeView) {
      case 'dashboard': return <DashboardPage />;
      case 'websites': return <WebsitesPage />;
      case 'apikeys': return <ApiKeysPage />;
      case 'keywords': return <KeywordsPage />;
      case 'scheduler': return <SchedulerPage />;
      case 'logs': return <LogsPage />;
      default: return <DashboardPage />;
    }
  };

  const NavBtn = ({id, icon:I, label}) => (
    <button onClick={()=>{setActiveView(id); setIsMobileMenuOpen(false)}} className={`flex items-center gap-3 p-3 w-full rounded mb-1 transition-colors ${activeView===id ? 'bg-green-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
        <I size={20}/> <span className={isSidebarCollapsed ? 'hidden' : ''}>{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden">
        {/* Sidebar */}
        <aside className={`border-r border-slate-800 bg-slate-950 flex flex-col transition-all ${isSidebarCollapsed ? 'w-16' : 'w-64'} ${isMobileMenuOpen ? 'fixed inset-y-0 left-0 z-50 w-64' : 'hidden md:flex'}`}>
            <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
                {!isSidebarCollapsed && <span className="font-bold text-xl text-green-500">ContentStack</span>}
                <button onClick={()=>setIsSidebarCollapsed(!isSidebarCollapsed)} className="text-slate-400 hidden md:block"><ChevronLeft/></button>
                <button onClick={()=>setIsMobileMenuOpen(false)} className="text-slate-400 md:hidden"><X/></button>
            </div>
            <div className="p-2 flex-1 mt-4 overflow-y-auto">
                <NavBtn id="dashboard" icon={LayoutDashboard} label="Dashboard" />
                <NavBtn id="scheduler" icon={Clock} label="Scheduler" />
                <NavBtn id="keywords" icon={Type} label="Keywords" />
                <NavBtn id="logs" icon={Activity} label="Logs" />
                <div className="my-4 border-t border-slate-800"></div>
                <NavBtn id="websites" icon={Globe} label="Websites" />
                <NavBtn id="apikeys" icon={KeyRound} label="API Keys" />
            </div>
            <div className="p-4 border-t border-slate-800">
                <button onClick={()=>setIsRunning(!isRunning)} className={`w-full py-3 rounded font-bold flex justify-center items-center gap-2 ${isRunning ? 'bg-red-500/20 text-red-400' : 'bg-green-600 text-white'}`}>
                    {isRunning ? <PauseCircle/> : <PlayCircle/>} {!isSidebarCollapsed && (isRunning ? 'Stop System' : 'Start System')}
                </button>
            </div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col min-w-0">
            <header className="h-16 border-b border-slate-800 bg-slate-900 flex items-center justify-between px-4">
                <div className="flex items-center gap-3">
                    <button onClick={()=>setIsMobileMenuOpen(true)} className="md:hidden"><Menu/></button>
                    <h2 className="font-bold text-lg capitalize">{activeView}</h2>
                </div>
                <div className="text-sm">Status: <span className={isRunning?'text-green-400 animate-pulse':'text-slate-500'}>{isRunning?'Running...':'Paused'}</span></div>
            </header>

            <div className="flex-1 overflow-auto p-4 md:p-8">
                {renderView()}
            </div>
        </main>
    </div>
  );
};

export default App;


