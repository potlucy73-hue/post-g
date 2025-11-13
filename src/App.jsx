import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  LayoutDashboard, Settings, ListTodo, Activity, PlayCircle, 
  PauseCircle, Trash2, Save, ChevronLeft, Menu, CheckCircle
} from 'lucide-react';

// --- SYSTEM PROMPT (Strict JSON Mode) ---
const SYSTEM_PROMPT = `
You are a professional recipe blogger API. 
You must output a VALID JSON object for the given recipe title.
Do NOT write any introduction, markdown code blocks, or comments. Just the raw JSON object.

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
3. Do not include the recipe card in the "article" field (it will be generated separately).
`;

// --- PRE-LOADED CONFIGURATION (Tumhari Di Hui Details) ---
const DEFAULT_CONFIG = {
  // LLM
  geminiKey: 'AIzaSyBHUXFhDHf_j2_-PRWizrEoz1bm6-2i_yU', 
  
  // Google Images
  googleApiKey: 'AIzaSyDMfAv6gP6Uzldn68Y-LKLLTzS1tx5n1TU',     
  searchEngineId: '35d066ed52c084df9',   
  
  // WordPress
  wpUrl: 'https://flavorzing.com',
  wpUsername: 'hh',
  wpAppPassword: 'Y1zI8Qm58IRF q10V16GloCpo',
  
  // Defaults
  authorName: 'Alina',  
  postStatus: 'draft',
  batchDelay: 5,       
  enableImages: true
};

const App = () => {
  const [activeView, setActiveView] = useState('dashboard'); // Direct to Dashboard
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [queue, setQueue] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ total: 0, success: 0, failed: 0 });
  const [bulkInput, setBulkInput] = useState('');
  const logContainerRef = useRef(null);

  // Init
  useEffect(() => {
    // Force load default config every time to ensure keys are present
    setConfig(DEFAULT_CONFIG);
    
    const localQueue = localStorage.getItem('rab_queue_v3');
    const localStats = localStorage.getItem('rab_stats_v3');
    
    if (localQueue) setQueue(JSON.parse(localQueue));
    if (localStats) setStats(JSON.parse(localStats));
    
    addLog('System Initialized. All APIs & Credentials Pre-loaded.', 'system');
    addLog(`Connected to: ${DEFAULT_CONFIG.wpUrl}`, 'info');
  }, []);

  useEffect(() => {
    localStorage.setItem('rab_queue_v3', JSON.stringify(queue));
    localStorage.setItem('rab_stats_v3', JSON.stringify(stats));
  }, [queue, stats]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const addLog = (msg, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { id: Date.now(), time: timestamp, msg, type }]);
  };

  const getAuthHeader = () => {
    // Using config values directly
    const token = btoa(`${config.wpUsername}:${config.wpAppPassword}`);
    return { 'Authorization': `Basic ${token}`, 'Content-Type': 'application/json' };
  };

  // Robust JSON Parser
  const cleanAndParseJSON = (text) => {
    try {
      let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanText);
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch(e2) {}
      }
      throw new Error("Gemini response was not valid JSON.");
    }
  };

  // 1. Gemini Gen
  const generateRecipeContent = async (title) => {
    addLog(`Generating content for: ${title}...`, 'info');
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${config.geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate a complete recipe JSON for: "${title}"` }] }],
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      
      const data = await res.json();
      if (!data.candidates?.[0]?.content) throw new Error(data.error?.message || "Gemini API blocked request");
      
      const jsonText = data.candidates[0].content.parts[0].text;
      return cleanAndParseJSON(jsonText);
    } catch (e) {
      throw new Error(`Gemini Error: ${e.message}`);
    }
  };

  // 2. Image Handler
  const handleImages = async (query) => {
    if (!config.enableImages) return { featuredId: null, bodyUrls: [] };
    
    addLog(`Searching images for: ${query}...`, 'info');
    try {
        const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&cx=${config.searchEngineId}&searchType=image&key=${config.googleApiKey}&num=4&safe=active`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.items) return { featuredId: null, bodyUrls: [] };

        const uploadPromises = data.items.map(async (item) => {
            try {
                const imgRes = await fetch(item.link);
                const blob = await imgRes.blob();
                const filename = `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.jpg`;
                const formData = new FormData();
                formData.append('file', blob, filename);

                const wpRes = await fetch(`${config.wpUrl}/wp-json/wp/v2/media`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${btoa(`${config.wpUsername}:${config.wpAppPassword}`)}`,
                        'Content-Disposition': `attachment; filename=${filename}`
                    },
                    body: formData
                });
                const wpData = await wpRes.json();
                return wpData.id ? { id: wpData.id, url: wpData.source_url } : null;
            } catch (e) {
                return null;
            }
        });

        const results = (await Promise.all(uploadPromises)).filter(r => r !== null);
        if (results.length === 0) return { featuredId: null, bodyUrls: [] };
        
        return {
            featuredId: results[0].id,
            bodyUrls: results.slice(1).map(r => r.url)
        };
    } catch (e) {
        addLog(`Image Error: ${e.message}`, 'warning');
        return { featuredId: null, bodyUrls: [] };
    }
  };

  // 3. WPRM
  const createWprmRecipe = async (recipeData, imageId) => {
    addLog('Creating Recipe Card...', 'info');
    try {
        const payload = {
            recipe: {
                name: recipeData.title,
                author: config.authorName,
                summary: `Learn how to make ${recipeData.title} at home.`,
                servings: recipeData.servings,
                prep_time: recipeData.prep_time,
                cook_time: recipeData.cook_time,
                total_time: (parseInt(recipeData.prep_time||0)+parseInt(recipeData.cook_time||0)).toString(),
                ingredients: recipeData.ingredients.map(s => ({ name: s.name, ingredients: s.items.map(i => ({ raw: i })) })),
                instructions: recipeData.instructions.map(s => ({ name: s.name, instructions: s.steps.map(i => ({ text: i })) }))
            }
        };
        if (imageId) payload.recipe.image_id = imageId;

        const res = await fetch(`${config.wpUrl}/wp-json/wp/v2/wprm_recipe`, {
            method: 'POST', headers: getAuthHeader(), body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.id) return data.id;
        throw new Error("WPRM returned no ID");
    } catch (e) {
        addLog('WPRM failed (Plugin missing?). Skipping card.', 'warning');
        return null;
    }
  };

  // 4. Post
  const createPost = async (recipeData, recipeId, featuredId, imageUrls) => {
    addLog('Publishing to WordPress...', 'info');
    
    let content = recipeData.article;
    
    if (imageUrls.length > 0) {
        const parts = content.split('</p>');
        content = '';
        let imgIndex = 0;
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

    const res = await fetch(`${config.wpUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: getAuthHeader(),
        body: JSON.stringify({
            title: recipeData.title,
            content: content,
            status: config.postStatus,
            categories: recipeData.categories || [1],
            featured_media: featuredId
        })
    });
    
    const data = await res.json();
    if (!data.id) throw new Error(data.message || "Post failed");
    return data.link;
  };

  // Worker
  const processQueueItem = useCallback(async () => {
    const pendingIndex = queue.findIndex(i => i.status === 'pending');
    if (pendingIndex === -1) {
      setIsRunning(false);
      addLog('Queue Completed!', 'success');
      return;
    }

    const item = queue[pendingIndex];
    const newQueue = [...queue];
    newQueue[pendingIndex].status = 'processing';
    setQueue(newQueue);

    try {
        const recipeData = await generateRecipeContent(item.title);
        const { featuredId, bodyUrls } = await handleImages(item.title + " recipe");
        const wprmId = await createWprmRecipe(recipeData, featuredId);
        const link = await createPost(recipeData, wprmId, featuredId, bodyUrls);

        newQueue[pendingIndex].status = 'completed';
        newQueue[pendingIndex].link = link;
        setStats(s => ({ ...s, success: s.success + 1 }));
        addLog(`Published: ${item.title}`, 'success');
    } catch (e) {
        newQueue[pendingIndex].status = 'failed';
        newQueue[pendingIndex].error = e.message;
        setStats(s => ({ ...s, failed: s.failed + 1 }));
        addLog(`Failed ${item.title}: ${e.message}`, 'error');
    }
    setQueue(newQueue);
  }, [queue, config]);

  useEffect(() => {
    let timer;
    if (isRunning) {
        const hasPending = queue.some(i => i.status === 'pending');
        const isProcessing = queue.some(i => i.status === 'processing');
        if (hasPending && !isProcessing) timer = setTimeout(processQueueItem, 2000);
        else if (!hasPending && !isProcessing) setIsRunning(false);
    }
    return () => clearTimeout(timer);
  }, [isRunning, queue, processQueueItem]);

  const handleAdd = () => {
    if (!bulkInput.trim()) return;
    const lines = bulkInput.split('\n').filter(l => l.trim());
    setQueue(prev => [...prev, ...lines.map(t => ({ id: Date.now()+Math.random(), title: t, status: 'pending' }))]);
    setBulkInput('');
    setActiveView('queue');
  };

  const NavBtn = ({id, icon:I, label}) => (
    <button onClick={()=>{setActiveView(id); setIsMobileMenuOpen(false)}} className={`flex items-center gap-3 p-3 w-full rounded mb-1 transition-colors ${activeView===id ? 'bg-green-600 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
        <I size={20}/> <span className={isSidebarCollapsed ? 'hidden' : ''}>{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden">
        {/* Sidebar */}
        <aside className={`border-r border-slate-800 bg-slate-950 flex flex-col transition-all ${isSidebarCollapsed ? 'w-16' : 'w-64'} ${isMobileMenuOpen ? 'fixed inset-y-0 left-0 z-50' : 'hidden md:flex'}`}>
            <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
                {!isSidebarCollapsed && <span className="font-bold text-xl text-green-500">FlavorBot</span>}
                <button onClick={()=>setIsSidebarCollapsed(!isSidebarCollapsed)} className="text-slate-400"><ChevronLeft/></button>
            </div>
            <div className="p-2 flex-1 mt-4">
                <NavBtn id="dashboard" icon={LayoutDashboard} label="Dashboard" />
                <NavBtn id="queue" icon={ListTodo} label="Queue" />
                <NavBtn id="settings" icon={Settings} label="Credentials" />
                <NavBtn id="logs" icon={Activity} label="Live Logs" />
            </div>
            <div className="p-4 border-t border-slate-800">
                <button onClick={()=>setIsRunning(!isRunning)} className={`w-full py-3 rounded font-bold flex justify-center items-center gap-2 ${isRunning ? 'bg-red-500/20 text-red-400' : 'bg-green-600 text-white'}`}>
                    {isRunning ? <PauseCircle/> : <PlayCircle/>} {!isSidebarCollapsed && (isRunning ? 'Stop' : 'Start')}
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
                <div className="text-sm">Status: <span className={isRunning?'text-green-400 animate-pulse':'text-slate-500'}>{isRunning?'Running...':'Ready'}</span></div>
            </header>

            <div className="flex-1 overflow-auto p-4 md:p-8">
                
                {activeView === 'dashboard' && (
                    <div className="max-w-4xl mx-auto">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div className="bg-slate-800 p-4 rounded border border-slate-700 shadow-lg"><h3>Pending Tasks</h3><p className="text-3xl font-bold mt-2">{queue.filter(i=>i.status==='pending').length}</p></div>
                            <div className="bg-slate-800 p-4 rounded border border-slate-700 shadow-lg"><h3>Completed</h3><p className="text-3xl font-bold mt-2 text-green-400">{stats.success}</p></div>
                            <div className="bg-slate-800 p-4 rounded border border-slate-700 shadow-lg"><h3>Errors</h3><p className="text-3xl font-bold mt-2 text-red-400">{stats.failed}</p></div>
                        </div>
                        
                        <div className="bg-slate-800 p-6 rounded border border-slate-700 shadow-xl">
                            <h3 className="font-bold mb-4 text-xl text-green-400">Add Recipes to Generate</h3>
                            <p className="text-slate-400 text-sm mb-2">Enter recipe titles below (one per line). The system will handle content, images, and WP posting.</p>
                            <textarea value={bulkInput} onChange={e=>setBulkInput(e.target.value)} className="w-full h-48 bg-slate-900 border border-slate-600 rounded p-4 mb-4 focus:border-green-500 outline-none text-lg" placeholder="e.g. Creamy Garlic Chicken&#10;Classic Beef Lasagna&#10;Chocolate Chip Cookies"></textarea>
                            <button onClick={handleAdd} className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded w-full text-lg flex items-center justify-center gap-2">
                               <PlayCircle size={20}/> Add to Queue
                            </button>
                        </div>
                    </div>
                )}

                {activeView === 'settings' && (
                    <div className="max-w-2xl mx-auto bg-slate-800 rounded border border-slate-700 p-8 text-center">
                        <div className="flex justify-center mb-4"><CheckCircle size={64} className="text-green-500"/></div>
                        <h3 className="font-bold text-2xl text-white mb-2">System is Pre-Configured</h3>
                        <p className="text-slate-400 mb-6">All your API keys and WordPress credentials have been hardcoded into the system.</p>
                        
                        <div className="bg-slate-900 rounded p-4 text-left space-y-3 text-sm font-mono border border-slate-700">
                            <div className="flex justify-between"><span>Target Site:</span> <span className="text-green-400">{config.wpUrl}</span></div>
                            <div className="flex justify-between"><span>User:</span> <span className="text-blue-400">{config.wpUsername}</span></div>
                            <div className="flex justify-between"><span>Gemini Key:</span> <span className="text-yellow-400">Loaded (Ends in ...2i_yU)</span></div>
                            <div className="flex justify-between"><span>Image Search:</span> <span className="text-purple-400">Enabled</span></div>
                        </div>
                        
                        <div className="mt-6 text-slate-500 text-xs">
                            To change credentials, you need to update the source code variables.
                        </div>
                    </div>
                )}

                {activeView === 'queue' && (
                    <div className="max-w-5xl mx-auto bg-slate-800 rounded border border-slate-700 overflow-hidden">
                        <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                            <h3 className="font-bold">Processing Queue</h3>
                            <button onClick={()=>setQueue([])} className="text-red-400 text-sm flex items-center gap-1 hover:bg-red-900/20 px-2 py-1 rounded"><Trash2 size={16}/> Clear</button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-900 text-slate-400"><tr><th className="p-4">Recipe Title</th><th className="p-4">Status</th><th className="p-4">Details</th></tr></thead>
                                <tbody className="divide-y divide-slate-700">
                                    {queue.length === 0 && <tr><td colSpan="3" className="p-8 text-center text-slate-500">No recipes in queue. Go to Dashboard to add some.</td></tr>}
                                    {queue.map(item => (
                                        <tr key={item.id} className="hover:bg-slate-700/50 transition-colors">
                                            <td className="p-4 font-medium text-white">{item.title}</td>
                                            <td className="p-4"><span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${item.status==='completed'?'bg-green-500/20 text-green-400 border border-green-500/30':item.status==='failed'?'bg-red-500/20 text-red-400 border border-red-500/30':item.status==='processing'?'bg-blue-500/20 text-blue-400 animate-pulse border border-blue-500/30':'bg-slate-700 text-slate-300'}`}>{item.status}</span></td>
                                            <td className="p-4">{item.link ? <a href={item.link} target="_blank" className="text-blue-400 hover:text-blue-300 hover:underline">Open Post ↗</a> : item.error ? <span className="text-red-400 truncate block max-w-xs" title={item.error}>{item.error}</span> : <span className="text-slate-600">Pending...</span>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeView === 'logs' && (
                    <div className="bg-black text-green-400 font-mono text-xs p-4 rounded border border-slate-700 h-full overflow-auto shadow-inner" ref={logContainerRef}>
                        {logs.length === 0 && <div className="opacity-50">Waiting for logs...</div>}
                        {logs.map(l => <div key={l.id} className="mb-1 border-b border-green-900/20 pb-1 last:border-0"><span className="opacity-50 mr-2">[{l.time}]</span> {l.msg}</div>)}
                    </div>
                )}
            </div>
        </main>
    </div>
  );
};

export default App;

