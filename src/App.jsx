import React, { useState, useRef, useEffect } from "react";
import { marked } from "marked";

export default function App() {
  // ── State Management ────────────────────────────────────────────────
  const [pipelineState, setPipelineState] = useState("IDLE"); // IDLE, RECORDING, PREVIEW, PROCESSING, REVIEW, SUCCESS, ERROR
  const [processingMsg, setProcessingMsg] = useState("");
  const [processingProgress, setProcessingProgress] = useState(10);

  // Dual-input state
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioFileName, setAudioFileName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [contextTemplate, setContextTemplate] = useState("feature-design");
  const [persistedAudioUrl, setPersistedAudioUrl] = useState("");

  // Review & Gate state
  const [rawTranscript, setRawTranscript] = useState("");
  const [structuredText, setStructuredText] = useState("");
  const [segments, setSegments] = useState([]);
  const [redoVersion, setRedoVersion] = useState(1);
  const [redoFeedback, setRedoFeedback] = useState("");
  const [activeReviewTab, setActiveReviewTab] = useState("preview"); // preview, edit, raw
  const [isSubmittingApprove, setIsSubmittingApprove] = useState(false);
  const [isSubmittingRedo, setIsSubmittingRedo] = useState(false);

  // Audio player refs
  const previewPlayerRef = useRef(null);
  const reviewPlayerRef = useRef(null);
  const historyPlayerRef = useRef(null);

  // ── Citation & Seek Audio Helpers ────────────────────────────────────
  function timestampToSeconds(ts) {
    if (!ts) return 0;
    const parts = ts.split(":").map(Number);
    if (parts.some((n) => Number.isNaN(n))) return 0;
    if (parts.length === 3) {
      const [h, m, s] = parts;
      return h * 3600 + m * 60 + s;
    }
    if (parts.length === 2) {
      const [m, s] = parts;
      return m * 60 + s;
    }
    return Number(ts) || 0;
  }

  const seekAudioPlayer = (seconds) => {
    const activePlayer = 
      pipelineState === "REVIEW" 
        ? reviewPlayerRef.current 
        : selectedHistoryItem 
          ? historyPlayerRef.current 
          : previewPlayerRef.current;
          
    if (activePlayer) {
      activePlayer.currentTime = seconds;
      activePlayer.play().catch(e => console.log("Audio play interrupted:", e));
    }
  };

  const handleCitationClick = (segId) => {
    const seg = segments.find(s => s.id === segId);
    if (seg) {
      seekAudioPlayer(timestampToSeconds(seg.start));
    }
  };

  const handleContainerClick = (e) => {
    const target = e.target.closest(".citation-link");
    if (target) {
      e.preventDefault();
      const refVal = target.getAttribute("data-citation");
      if (refVal) {
        if (refVal.startsWith("seg_")) {
          handleCitationClick(refVal);
        } else {
          seekAudioPlayer(timestampToSeconds(refVal));
        }
      }
    }
  };

  const formatCitationsForPreview = (markdownText) => {
    if (!markdownText) return "";
    let processed = markdownText.replace(/seg_\d+/g, (match) => {
      return `<a href="#" class="citation-link font-mono text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-1.5 py-0.5 rounded border border-indigo-100 mx-0.5" data-citation="${match}">${match}</a>`;
    });
    processed = processed.replace(/\b\d{2}:\d{2}(?:\.\d+)?\b/g, (match) => {
      return `<a href="#" class="citation-link font-mono text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-1.5 py-0.5 rounded border border-indigo-100 mx-0.5" data-citation="${match}">${match}</a>`;
    });
    return processed;
  };

  // Success state
  const [successInfo, setSuccessInfo] = useState({
    id: "",
    url: "",
    title: "",
    message: ""
  });

  // Proposed Solution state
  const [proposedSolution, setProposedSolution] = useState("");
  const [isViewingSolution, setIsViewingSolution] = useState(false);
  const [isEditingSolution, setIsEditingSolution] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");
  const [approveLoadingMsg, setApproveLoadingMsg] = useState("");

  // Sidebar navigation state
  const [activeTab, setActiveTab] = useState("stakeholder-input"); // stakeholder-input, agent-studio, workflow-library, devops-sync, settings

  // Workspace Data Aggregation (project history)
  const [projectHistory, setProjectHistory] = useState(() => {
    const saved = localStorage.getItem("project_history");
    return saved ? JSON.parse(saved) : [];
  });

  // Selected history item for detailed view
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null);

  useEffect(() => {
    if (selectedHistoryItem) {
      setSegments(selectedHistoryItem.segments || []);
    } else {
      setSegments([]);
    }
  }, [selectedHistoryItem]);

  // Active agent prompt configurations (stored in localStorage)
  const [analystPrompt, setAnalystPrompt] = useState(() => {
    return localStorage.getItem("analyst_prompt") || "";
  });
  const [solutionPrompt, setSolutionPrompt] = useState(() => {
    return localStorage.getItem("solution_prompt") || "";
  });

  // Audio Ingestion tab mode (upload vs record)
  const [audioInputMode, setAudioInputMode] = useState("upload");

  // Local settings overrides
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-1.5-flash");
  const [devopsOrgUrl, setDevopsOrgUrl] = useState("");
  const [devopsPat, setDevopsPat] = useState("");
  const [devopsProject, setDevopsProject] = useState("");
  const [devopsWorkItemType, setDevopsWorkItemType] = useState("Task");

  const [settingsStatus, setSettingsStatus] = useState(null); // null, or { type: 'success'|'error', msg: '...' }
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Load settings from backend on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings`);
        if (res.ok) {
          const data = await res.json();
          if (data.geminiApiKey) setGeminiApiKey(data.geminiApiKey);
          if (data.geminiModel) setGeminiModel(data.geminiModel);
          if (data.devopsOrgUrl) setDevopsOrgUrl(data.devopsOrgUrl);
          if (data.devopsPat) setDevopsPat(data.devopsPat);
          if (data.devopsProject) setDevopsProject(data.devopsProject);
          if (data.devopsWorkItemType) setDevopsWorkItemType(data.devopsWorkItemType);
        }
      } catch (err) {
        console.error("Failed to fetch settings from backend:", err);
      }
    };
    fetchSettings();
  }, []);

  // Error state
  const [errorMessage, setErrorMessage] = useState("");

  // Checkbox Selection & Custom Modal Delete states
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // ── Refs ────────────────────────────────────────────────────────────
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const fileInputRef = useRef(null);

  const API_BASE = "http://localhost:5000/api";

  // ── Recording Timer ─────────────────────────────────────────────────
  useEffect(() => {
    if (isRecording) {
      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [isRecording]);

  const formatTime = (secs) => {
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${m}:${s}`;
  };

  // ── Live Recording Logic ────────────────────────────────────────────
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        setAudioFileName("voice-recording.webm");

        // Stop stream tracks
        stream.getTracks().forEach((track) => track.stop());
        setPipelineState("PREVIEW");
      };

      mediaRecorder.start(250);
      setRecordingSeconds(0);
      setIsRecording(true);
      setPipelineState("RECORDING");
    } catch (err) {
      console.error(err);
      triggerError("Microphone access denied. Please allow microphone permissions and try again.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // ── File Drag-and-Drop Logic ───────────────────────────────────────
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processSelectedFile(e.target.files[0]);
    }
  };

  const processSelectedFile = (file) => {
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > 25) {
      triggerError(`File size (${sizeMb.toFixed(1)}MB) exceeds 25MB limit.`);
      return;
    }

    const url = URL.createObjectURL(file);
    setAudioBlob(file);
    setAudioUrl(url);
    setAudioFileName(file.name);
    setPipelineState("PREVIEW");
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  const clearSelectedAudio = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioFileName("");
    setPipelineState("IDLE");
  };

  // ── Submit & Pipeline Orchestration ─────────────────────────────────
  const submitAudio = async () => {
    // If no audio is selected/recorded but user pasted text, process raw text directly
    if (!audioBlob && pastedText.trim()) {
      await submitPastedText();
      return;
    }

    if (!audioBlob) return;

    setPipelineState("PROCESSING");
    setProcessingProgress(15);
    setProcessingMsg("Uploading audio data...");

    const formData = new FormData();
    formData.append("audio", audioBlob, audioFileName);
    if (analystPrompt) {
      formData.append("prompt_override", analystPrompt);
    }

    const progressInterval = setInterval(() => {
      setProcessingProgress((prev) => {
        if (prev < 40) {
          setProcessingMsg("Transcribing with Google Gemini Whisper...");
          return prev + 3;
        } else if (prev < 80) {
          setProcessingMsg("Structuring requirements with Gemini...");
          return prev + 1;
        } else if (prev < 95) {
          setProcessingMsg("Finalizing agile template formatting...");
          return prev + 0.5;
        }
        return prev;
      });
    }, 500);

    try {
      const res = await fetch(`${API_BASE}/transcribe`, {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      clearInterval(progressInterval);

      if (!res.ok) {
        throw new Error(data.error || "Audio transcription failed.");
      }

      setRawTranscript(data.raw_transcript);
      setStructuredText(data.structured_text);
      setSegments(data.segments || []);
      setPersistedAudioUrl(data.audio_url || "");
      setRedoVersion(1);
      setRedoFeedback("");
      setActiveReviewTab("preview");
      setPipelineState("REVIEW");
    } catch (err) {
      clearInterval(progressInterval);
      triggerError(err.message);
    }
  };

  const submitPastedText = async () => {
    setPipelineState("PROCESSING");
    setProcessingProgress(20);
    setProcessingMsg("Analyzing pasted text content...");

    const progressInterval = setInterval(() => {
      setProcessingProgress((prev) => {
        if (prev < 70) {
          setProcessingMsg("Processing layout structure via Gemini...");
          return prev + 5;
        } else if (prev < 95) {
          setProcessingMsg("Building agile functional templates...");
          return prev + 1;
        }
        return prev;
      });
    }, 400);

    try {
      const res = await fetch(`${API_BASE}/structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_transcript: pastedText,
          prompt_override: analystPrompt
        })
      });

      const data = await res.json();
      clearInterval(progressInterval);

      if (!res.ok) {
        throw new Error(data.error || "Pasted text structuring failed.");
      }

      setRawTranscript(pastedText);
      setStructuredText(data.structured_text);
      setSegments(data.segments || []);
      setRedoVersion(1);
      setRedoFeedback("");
      setActiveReviewTab("preview");
      setPipelineState("REVIEW");
    } catch (err) {
      clearInterval(progressInterval);
      triggerError(err.message);
    }
  };

  // ── Redo / Refine Logic ─────────────────────────────────────────────
  const triggerRedo = async () => {
    setIsSubmittingRedo(true);
    try {
      const res = await fetch(`${API_BASE}/redo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_text: structuredText,
          feedback: redoFeedback,
          prompt_override: analystPrompt,
          segments: segments
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Re-generation failed.");
      }

      setStructuredText(data.structured_text);
      setRedoVersion((prev) => prev + 1);
      setRedoFeedback(""); // Reset comment box
      setActiveReviewTab("preview"); // Switch back to preview tab
    } catch (err) {
      triggerError(err.message);
    } finally {
      setIsSubmittingRedo(false);
    }
  };

  const triggerStructureFromRaw = async () => {
    setIsSubmittingRedo(true);
    try {
      const res = await fetch(`${API_BASE}/structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raw_transcript: rawTranscript,
          prompt_override: analystPrompt
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Re-structuring failed.");
      }

      setStructuredText(data.structured_text);
      setRedoVersion((prev) => prev + 1);
      setRedoFeedback(""); // Reset comment box
      setActiveReviewTab("preview"); // Switch back to preview tab
    } catch (err) {
      triggerError(err.message);
    } finally {
      setIsSubmittingRedo(false);
    }
  };

  // ── Approve & Ship Logic ────────────────────────────────────────────
  const triggerApprove = async () => {
    setIsSubmittingApprove(true);
    setApproveLoadingMsg("Drafting Proposed Solution...");
    try {
      // Step A: Generate technical solution
      const solRes = await fetch(`${API_BASE}/generate-solution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved_text: structuredText,
          prompt_override: solutionPrompt
        })
      });

      const solData = await solRes.json();
      if (!solRes.ok) {
        throw new Error(solData.error || "Failed to generate technical solution.");
      }

      const generatedSolution = solData.proposed_solution;
      setProposedSolution(generatedSolution);

      // Step B: Approve and create work item in DevOps
      setApproveLoadingMsg("Pushing to DevOps...");
      const approveRes = await fetch(`${API_BASE}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approved_text: structuredText,
          proposed_solution: generatedSolution
        })
      });

      const approveData = await approveRes.json();
      if (!approveRes.ok) {
        throw new Error(approveData.error || "Azure DevOps Work Item creation failed.");
      }

      setSuccessInfo({
        id: approveData.work_item_id,
        url: approveData.work_item_url,
        title: approveData.title,
        message: approveData.message
      });
      setWarningMessage(approveData.warning || "");

      // Save to aggregated project history workspace data engine
      const newHistoryItem = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        source: audioFileName ? `Audio file: ${audioFileName}` : "Live Voice Recording",
        rawTranscript: rawTranscript,
        segments: segments,
        structuredPRD: structuredText,
        proposedSolution: generatedSolution,
        devopsId: approveData.work_item_id,
        devopsUrl: approveData.work_item_url,
        devopsTitle: approveData.title,
        status: "completed",
        persistedAudioUrl: persistedAudioUrl
      };

      const updatedHistory = [newHistoryItem, ...projectHistory];
      setProjectHistory(updatedHistory);
      localStorage.setItem("project_history", JSON.stringify(updatedHistory));

      setPipelineState("SUCCESS");
    } catch (err) {
      triggerError(err.message);
    } finally {
      setIsSubmittingApprove(false);
      setApproveLoadingMsg("");
    }
  };

  // ── Reset ───────────────────────────────────────────────────────────
  const resetAll = () => {
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioFileName("");
    setPastedText("");
    setRawTranscript("");
    setStructuredText("");
    setPersistedAudioUrl("");
    setRedoVersion(1);
    setRedoFeedback("");
    setProposedSolution("");
    setIsViewingSolution(false);
    setIsEditingSolution(false);
    setWarningMessage("");
    setSegments([]);
    setPipelineState("IDLE");
  };

  const triggerError = (msg) => {
    setErrorMessage(msg);
    setPipelineState("ERROR");
  };

  // Save agent settings overrides
  const saveAgentConfigs = (e) => {
    e.preventDefault();
    localStorage.setItem("analyst_prompt", analystPrompt);
    localStorage.setItem("solution_prompt", solutionPrompt);
    alert("Agent Prompts updated successfully! New prompts will be used in future runs.");
  };

  // Save settings overrides
  const saveGlobalSettings = async (e) => {
    e.preventDefault();
    setSettingsStatus(null);
    setIsSavingSettings(true);

    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          geminiApiKey,
          geminiModel,
          devopsOrgUrl,
          devopsPat,
          devopsProject,
          devopsWorkItemType
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Save settings and connection test failed.");
      }

      // Save to localStorage as backup/cache
      localStorage.setItem("settings_gemini_api_key", geminiApiKey);
      localStorage.setItem("settings_gemini_model", geminiModel);
      localStorage.setItem("settings_devops_org_url", devopsOrgUrl);
      localStorage.setItem("settings_devops_pat", devopsPat);
      localStorage.setItem("settings_devops_project", devopsProject);
      localStorage.setItem("settings_devops_work_item_type", devopsWorkItemType);

      setSettingsStatus({
        type: "success",
        msg: data.message || "Settings saved and connection test successful!"
      });
    } catch (err) {
      console.error(err);
      setSettingsStatus({
        type: "error",
        msg: err.message || "Failed to establish successful connection with settings."
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleToggleSelect = (id) => {
    setSelectedHistoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedHistoryIds.length === projectHistory.length) {
      setSelectedHistoryIds([]);
    } else {
      setSelectedHistoryIds(projectHistory.map((item) => item.id));
    }
  };

  const deleteSelectedHistory = () => {
    const updated = projectHistory.filter((item) => !selectedHistoryIds.includes(item.id));
    setProjectHistory(updated);
    localStorage.setItem("project_history", JSON.stringify(updated));
    setSelectedHistoryIds([]);
    setShowDeleteConfirm(false);
  };

  // Clear workspace data aggregation engine
  const clearWorkspaceHistory = () => {
    if (confirm("Are you sure you want to clear all aggregated workspace data? This is permanent.")) {
      setProjectHistory([]);
      localStorage.removeItem("project_history");
    }
  };

  // Calculate Real-Time Status of Each Stage in the Active Scope
  const getStageStatus = (stage) => {
    // Stage 1: START (Ingested Input)
    if (stage === "start") {
      if (pipelineState === "IDLE" && !audioBlob && !pastedText.trim()) return "waiting";
      if (["RECORDING", "PREVIEW", "PROCESSING"].includes(pipelineState)) return "active";
      return "completed";
    }

    // Stage 2: ORCHESTRATOR
    if (stage === "orchestrator") {
      if (["IDLE", "RECORDING", "PREVIEW"].includes(pipelineState)) return "waiting";
      if (pipelineState === "PROCESSING" && processingProgress < 40) return "active";
      return "completed";
    }

    // Stage 3: ANALYST AGENT (Transcription & PRD Draft)
    if (stage === "analyst") {
      if (["IDLE", "RECORDING", "PREVIEW"].includes(pipelineState)) return "waiting";
      if (pipelineState === "PROCESSING" && processingProgress >= 40 && processingProgress < 95) return "active";
      if (pipelineState === "REVIEW") return "completed";
      if (pipelineState === "SUCCESS") return "completed";
      return "waiting";
    }

    // Stage 4: REVIEW GATE (Human Checkpoint)
    if (stage === "checkpoint") {
      if (pipelineState === "REVIEW") return "active";
      if (pipelineState === "SUCCESS") return "completed";
      return "waiting";
    }

    // Stage 5: SCRUM AGENT (Azure DevOps Sync)
    if (stage === "scrum") {
      if (isSubmittingApprove) return "active";
      if (pipelineState === "SUCCESS") return "completed";
      return "waiting";
    }

    return "waiting";
  };

  const renderStatusDot = (status) => {
    if (status === "active") {
      return (
        <span className="flex items-center gap-1.5 text-xs text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100">
          <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
          Active
        </span>
      );
    }
    if (status === "completed") {
      return (
        <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          Completed
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
        <span className="w-2 h-2 rounded-full bg-slate-300"></span>
        Waiting
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">

      {/* Top Application Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-blue-500/20 font-bold font-mono text-base">
            AI
          </div>
          <h1 className="text-lg font-bold text-slate-800 font-outfit">
            AI-Powered Product Delivery Automation Platform
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <button className="text-slate-500 hover:text-slate-700 p-1.5 hover:bg-slate-100 rounded-lg transition-all relative">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-indigo-600 rounded-full border-2 border-white"></span>
          </button>
          <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 font-semibold text-xs border border-slate-300">
              MP
            </div>
            <span className="text-xs font-semibold text-slate-600 hidden md:inline">Test USer</span>
          </div>
        </div>
      </header>

      {/* Main Grid Workspace Shell */}
      <div className="flex-1 grid grid-cols-12">

        {/* Left Navigation Sidebar */}
        <aside className="col-span-12 lg:col-span-2 bg-slate-50 border-r border-slate-200 p-5 flex flex-col justify-between">
          <div className="space-y-6">
            <div>
              <span className="text-[11px] font-bold text-slate-400 tracking-wider uppercase block mb-3 font-mono">Project</span>
              <nav className="space-y-1">
                {[
                  {
                    id: "stakeholder-input", label: "Stakeholder Input", icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m0 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 000 16.271c0 2.274 1.258 4.254 3.118 5.278m14.93-10.155a5.001 5.001 0 00-9.499-1.004M15 4.75a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )
                  },
                  {
                    id: "agent-studio", label: "Agent Studio", icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.214-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )
                  },
                  {
                    id: "workflow-library", label: "Workflow Library", icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                      </svg>
                    )
                  },
                  {
                    id: "devops-sync", label: "DevOps Boards Sync", icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                    )
                  },
                  {
                    id: "settings", label: "Settings", icon: (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l.547.947a1.125 1.125 0 01-.26 1.43l-1.002.828c-.293.241-.438.613-.43.992a6.723 6.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-.548.947a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-1.094c-.55 0-1.02-.398-1.11-.94l-.214-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-.546-.947a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l.547-.947a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )
                  }
                ].map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveTab(item.id);
                        setSelectedHistoryItem(null);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${isActive
                        ? "bg-slate-200 text-slate-800 border-l-4 border-indigo-600 pl-2"
                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                        }`}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* Quick Settings Shortcut */}
          <div className="pt-4 border-t border-slate-200">
            <button
              onClick={() => setActiveTab("settings")}
              className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-800 w-full"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l.547.947a1.125 1.125 0 01-.26 1.43l-1.002.828c-.293.241-.438.613-.43.992a6.723 6.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-.548.947a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-1.094c-.55 0-1.02-.398-1.11-.94l-.214-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-.546-.947a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l.547-.947a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              </svg>
              Settings
            </button>
          </div>
        </aside>

        {/* Dynamic Workspace Container */}
        <main className="col-span-12 lg:col-span-10 p-6 md:p-8 flex flex-col justify-start overflow-y-auto">

          {/* TAB 1: Stakeholder Input (Main Sequence Flow) */}
          {activeTab === "stakeholder-input" && (
            <div className="grid grid-cols-12 gap-8 items-start">

              {/* Left Column: Input Ingestion Setup or Human Gate Review */}
              <div className="col-span-12 lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm min-h-[500px] flex flex-col justify-between">

                {(!geminiApiKey || !devopsPat || !devopsOrgUrl || !devopsProject) && (
                  <div
                    onClick={() => setActiveTab("settings")}
                    className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-semibold cursor-pointer hover:bg-amber-100 transition-all flex items-center gap-2"
                  >
                    <span>⚠️</span>
                    <span>
                      <strong>Configuration Required:</strong> Gemini API Key, DevOps Organization URL, PAT, or Project is missing. Click here to configure.
                    </span>
                  </div>
                )}

                {pipelineState === "IDLE" && (
                  <div className="flex-1 flex flex-col justify-between space-y-6">
                    <div>
                      <h2 className="text-lg font-bold text-slate-800">Project Setup & Task Initialization</h2>
                      <p className="text-slate-400 text-xs mt-1">Upload raw input on below.</p>
                    </div>

                    {/* Audio Input Tabs: File Upload OR Live Record */}
                    <div className="space-y-3">
                      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                        Audio Transcripts / Raw Notes
                      </label>

                      {/* Sub-tabs header */}
                      <div className="flex border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-1">
                        <button
                          type="button"
                          onClick={() => setAudioInputMode("upload")}
                          className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-all ${audioInputMode === "upload"
                            ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                            : "text-slate-500 hover:text-slate-800"
                            }`}
                        >
                          Upload audio
                        </button>
                        <button
                          type="button"
                          onClick={() => setAudioInputMode("record")}
                          className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-all ${audioInputMode === "record"
                            ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                            : "text-slate-500 hover:text-slate-800"
                            }`}
                        >
                          Record Live
                        </button>
                      </div>

                      {/* Tab Content A: Upload Zone */}
                      {audioInputMode === "upload" && (
                        <div
                          onDragEnter={handleDrag}
                          onDragOver={handleDrag}
                          onDragLeave={handleDrag}
                          onDrop={handleDrop}
                          onClick={triggerFileInput}
                          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${dragActive
                            ? "border-indigo-500 bg-indigo-500/5"
                            : "border-slate-300 hover:border-indigo-500/50 bg-slate-50/50"
                            }`}
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="audio/*"
                            onChange={handleFileChange}
                            className="hidden"
                          />
                          <svg className="w-8 h-8 text-slate-400 mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                          </svg>
                          <span className="text-xs font-semibold text-indigo-600 block hover:underline">
                            Audio Transcripts / Raw Notes
                          </span>
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            Drag & drop or click to choose file
                          </span>
                        </div>
                      )}

                      {/* Tab Content B: Live Record Zone */}
                      {audioInputMode === "record" && (
                        <div className="border border-slate-200 rounded-xl p-5 bg-slate-50 flex flex-col items-center justify-center space-y-4">
                          <button
                            type="button"
                            onClick={startRecording}
                            className="w-12 h-12 bg-red-100 hover:bg-red-200 text-red-600 rounded-full flex items-center justify-center transition-all border border-red-200 hover:scale-105 active:scale-95 shadow-sm"
                          >
                            <span className="w-4 h-4 bg-red-600 rounded-full animate-ping absolute"></span>
                            <span className="w-4.5 h-4.5 bg-red-600 rounded-full relative"></span>
                          </button>
                          <div className="text-center">
                            <span className="text-xs font-bold text-slate-700 block">Start Live Voice Recording</span>
                            <span className="text-[10px] text-slate-400 mt-0.5 block">Captures mic audio directly in-browser</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Text Notes Area */}
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                        Alternative: Paste Raw Text Notes
                      </label>
                      <textarea
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        placeholder="Paste text transcript or product raw requirements directly here..."
                        className="w-full h-24 bg-slate-50 text-slate-800 text-xs p-3 rounded-lg border border-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                      />
                    </div>

                    {/* Context Template Dropdown */}
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                        Project Context Template
                      </label>
                      <div className="relative">
                        <select
                          value={contextTemplate}
                          onChange={(e) => setContextTemplate(e.target.value)}
                          className="w-full bg-slate-50 text-slate-700 text-xs p-3 rounded-lg border border-slate-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 appearance-none font-semibold cursor-pointer"
                        >
                          <option value="feature-design">e.g. New Feature Design</option>
                          <option value="bug-fix">e.g. Bug Report & Resolution Analysis</option>
                          <option value="grooming">e.g. Refinement / Backlog Grooming</option>
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pipeline State: RECORDING */}
                {pipelineState === "RECORDING" && (
                  <div className="flex-1 flex flex-col justify-center items-center py-10 space-y-6 text-center">
                    <div className="relative flex items-center justify-center">
                      <div className="absolute w-24 h-24 bg-red-500/10 rounded-full animate-ping"></div>
                      <div className="w-16 h-16 bg-red-100 border border-red-200 text-red-600 rounded-full flex items-center justify-center shadow-lg relative">
                        <span className="w-6 h-6 bg-red-600 rounded-md"></span>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-800">Recording Live Audio</h3>
                      <p className="text-slate-400 text-xs mt-1">Speak clearly into your microphone...</p>
                    </div>
                    {/* Visualizer wave mock */}
                    <div className="flex items-center gap-1 h-6">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <span key={i} className="wave-bar w-1 bg-red-500 rounded-full h-full"></span>
                      ))}
                    </div>
                    <div className="text-2xl font-mono font-bold text-slate-700">
                      {formatTime(recordingSeconds)}
                    </div>
                    <button
                      onClick={stopRecording}
                      className="py-3 px-6 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-red-950/20 active:scale-98"
                    >
                      Stop Recording
                    </button>
                  </div>
                )}

                {/* Pipeline State: PREVIEW (Selected/Recorded Audio) */}
                {pipelineState === "PREVIEW" && (
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-800">Preview Audio Input</h2>
                      <p className="text-slate-400 text-xs mt-1">Listen to your recording or file before starting the pipeline.</p>
                    </div>

                    <div className="my-8 bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center border border-indigo-100">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-bold text-slate-700 block truncate">{audioFileName}</span>
                          <span className="text-[10px] text-slate-400 block font-mono">Ready for processing</span>
                        </div>
                      </div>

                      {audioUrl && (
                        <audio ref={previewPlayerRef} src={audioUrl} controls className="w-full rounded-md border border-slate-200 shadow-inner bg-slate-100" />
                      )}
                    </div>

                    <button
                      onClick={clearSelectedAudio}
                      className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-xl text-xs transition-all border border-slate-200 mb-2"
                    >
                      Clear & Try Different Input
                    </button>
                  </div>
                )}

                {/* Pipeline State: PROCESSING */}
                {pipelineState === "PROCESSING" && (
                  <div className="flex-1 flex flex-col justify-center items-center py-10 space-y-6 text-center">
                    <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Processing Audio Pipeline</h3>
                      <p className="text-indigo-600 text-xs mt-1 font-semibold">{processingMsg}</p>
                    </div>
                    {/* Simulated Progress bar */}
                    <div className="w-full max-w-xs bg-slate-100 rounded-full h-2 border border-slate-200 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-indigo-600 to-purple-600 h-full transition-all duration-300"
                        style={{ width: `${processingProgress}%` }}
                      ></div>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">Stage: Orchestrator &rarr; Analyst Agent</span>
                  </div>
                )}

                {/* Pipeline State: REVIEW (PRD Human gate review) */}
                {pipelineState === "REVIEW" && (
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-center border-b border-slate-200 pb-3 mb-4">
                        <div>
                          <h2 className="text-lg font-bold text-slate-800">Review Structured PRD</h2>
                          <p className="text-slate-400 text-xs">Human Gate Checkpoint 1</p>
                        </div>
                        <span className="bg-amber-100 border border-amber-200 text-amber-700 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase font-mono">
                          Revision v{redoVersion}
                        </span>
                      </div>

                      {/* Sub-tabs inside Review layout */}
                      <div className="flex border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-1 mb-4">
                        {[
                          { id: "preview", label: "Formatted Preview" },
                          { id: "edit", label: "Edit Markdown" },
                          { id: "raw", label: "Raw Transcript" }
                        ].map((tab) => (
                          <button
                            key={tab.id}
                            onClick={() => setActiveReviewTab(tab.id)}
                            className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-all ${activeReviewTab === tab.id
                              ? "bg-white text-indigo-600 shadow-sm border border-slate-200"
                              : "text-slate-500 hover:text-slate-800"
                              }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      {/* Content panel based on Tab */}
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 min-h-[220px] max-h-[300px] overflow-y-auto mb-4">
                        {activeReviewTab === "preview" && (
                          <div
                            className="prose prose-slate prose-xs text-slate-700 max-w-none text-left leading-relaxed prose-headings:text-slate-900 prose-headings:font-bold"
                            dangerouslySetInnerHTML={{ __html: marked.parse(formatCitationsForPreview(structuredText || "")) }}
                            onClick={handleContainerClick}
                          />
                        )}
                        {activeReviewTab === "edit" && (
                          <textarea
                            value={structuredText}
                            onChange={(e) => setStructuredText(e.target.value)}
                            className="w-full h-[220px] bg-slate-950 text-slate-200 font-mono text-xs p-3 rounded-lg border border-slate-800 focus:border-indigo-500 focus:outline-none resize-none"
                            placeholder="Edit requirements markdown..."
                          />
                        )}
                        {activeReviewTab === "raw" && (
                          segments && segments.length > 0 ? (
                            <div className="space-y-3 pr-2 text-left">
                              <div className="flex justify-between items-center mb-2 border-b border-slate-200 pb-1.5">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Diarized Segments</span>
                                <button 
                                  onClick={() => setSegments([])}
                                  className="text-[10px] text-indigo-600 hover:text-indigo-800 underline font-semibold font-mono"
                                >
                                  Edit Plain Text
                                </button>
                              </div>
                              {segments.map((seg, idx) => (
                                <div key={seg.id || idx} className="p-2.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-200 hover:shadow-sm transition-all flex flex-col gap-1.5">
                                  <div className="flex items-center justify-between text-[10px] font-semibold font-mono">
                                    <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">{seg.speaker || "Speaker"}</span>
                                    <button 
                                      onClick={() => seekAudioPlayer(timestampToSeconds(seg.start))}
                                      className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-100 flex items-center gap-1 transition-all"
                                    >
                                      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                      {seg.start || "00:00"}
                                    </button>
                                  </div>
                                  <p className="text-xs text-slate-700 leading-relaxed font-sans">{seg.text}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <textarea
                              value={rawTranscript}
                              onChange={(e) => setRawTranscript(e.target.value)}
                              className="w-full h-[220px] bg-slate-950 text-slate-200 font-mono text-xs p-3 rounded-lg border border-slate-800 focus:border-indigo-500 focus:outline-none resize-none"
                              placeholder="Modify raw transcription notes..."
                            />
                          )
                        )}
                      </div>

                      {/* Comment revision block */}
                      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 font-mono">
                          Refinement Prompt / Adjustment Instruction
                        </label>
                        <input
                          type="text"
                          value={redoFeedback}
                          onChange={(e) => setRedoFeedback(e.target.value)}
                          placeholder="e.g. 'Add latency goals', 'Include mobile offline requirement'"
                          className="w-full bg-white text-slate-700 text-xs p-2 rounded-lg border border-slate-200 focus:border-purple-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={activeReviewTab === "raw" ? triggerStructureFromRaw : triggerRedo}
                        disabled={isSubmittingRedo || isSubmittingApprove}
                        className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-50 disabled:text-slate-400 text-amber-600 font-semibold rounded-xl text-xs transition-all border border-slate-200 flex items-center justify-center gap-1.5"
                      >
                        {isSubmittingRedo ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"></span>
                            Re-drafting...
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                            Re-generate PRD
                          </>
                        )}
                      </button>

                      <button
                        onClick={triggerApprove}
                        disabled={isSubmittingApprove || isSubmittingRedo}
                        className="flex-1 py-2.5 px-4 bg-gradient-to-r from-emerald-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 text-white font-semibold rounded-xl text-xs transition-all shadow-md flex items-center justify-center gap-1.5"
                      >
                        {isSubmittingApprove ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                            {approveLoadingMsg}
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                            Approve & Sync Backlog
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Pipeline State: SUCCESS */}
                {pipelineState === "SUCCESS" && (
                  <div className="flex-1 flex flex-col justify-between">
                    <div className="text-center py-6">
                      <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 border border-emerald-100 shadow-inner">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
                        </svg>
                      </div>
                      <h2 className="text-xl font-bold text-slate-800">DevOps Backlog Synced</h2>
                      <p className="text-emerald-600 text-xs mt-1 font-semibold">{successInfo.message}</p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-2.5 font-mono">
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-400">Devops WorkItem ID</span>
                        <span className="text-indigo-600 font-bold">#{successInfo.id}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                        <span className="text-slate-400">Synced Title</span>
                        <span className="text-slate-700 truncate max-w-[200px]">{successInfo.title}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Sync Status</span>
                        <span className="text-emerald-600 font-bold uppercase">Success</span>
                      </div>
                      {warningMessage && (
                        <div className="bg-amber-50 border border-amber-100 text-amber-700 p-2 rounded-lg mt-2 text-[10px] leading-relaxed font-sans text-left">
                          <strong>Warning:</strong> {warningMessage}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 mt-4">
                      {proposedSolution && (
                        <button
                          onClick={() => setIsViewingSolution(true)}
                          className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-semibold rounded-xl text-xs transition-all border border-indigo-100 flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                          View Proposed Solution
                        </button>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={resetAll}
                          className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-xl text-xs transition-all border border-slate-200"
                        >
                          Initialize New Input
                        </button>
                        <a
                          href={successInfo.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition-all flex items-center justify-center gap-1 shadow-md shadow-indigo-100"
                        >
                          Open DevOps
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                {/* Pipeline State: ERROR */}
                {pipelineState === "ERROR" && (
                  <div className="flex-1 flex flex-col justify-between py-6 text-center">
                    <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-3 border border-red-100">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286Zm0 13.036h.008v.008H12v-.008Z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-800">Pipeline Failed</h2>
                      <p className="text-red-500 text-xs mt-1 leading-relaxed bg-red-50/50 p-3 rounded-lg border border-red-100 max-h-[150px] overflow-y-auto font-mono text-left">
                        {errorMessage}
                      </p>
                    </div>
                    <button
                      onClick={resetAll}
                      className="w-full mt-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition-all shadow-md"
                    >
                      Reset Workspace & Try Again
                    </button>
                  </div>
                )}

              </div>

              {/* Right Column: Visual Core Workflow Sequence */}
              <div className="col-span-12 lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm min-h-[500px] flex flex-col justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Core Workflow Sequence</h2>
                  <p className="text-slate-400 text-xs mt-1">Visualize multi-orchestrator / multi-agent orchestration.</p>

                  {/* Workflow Audio Integration */}
                  {audioUrl && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mt-3 flex items-center justify-between gap-3 animate-fadeIn">
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-[10px] font-bold text-slate-700 block truncate leading-tight">{audioFileName}</span>
                          <span className="text-[9px] text-indigo-600 font-semibold block leading-tight mt-0.5 font-mono uppercase tracking-wider">Active Workflow Input</span>
                        </div>
                      </div>
                      <div className="flex-1 max-w-[200px]">
                        <audio ref={reviewPlayerRef} src={audioUrl} controls className="w-full h-8 rounded bg-transparent" />
                      </div>
                    </div>
                  )}

                  {/* Legend dots */}
                  <div className="flex justify-end gap-3 mt-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider font-mono">
                      <span className="w-2 h-2 rounded-full bg-indigo-600"></span> Active
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider font-mono">
                      <span className="w-2 h-2 rounded-full bg-slate-300"></span> Waiting
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wider font-mono">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Completed
                    </div>
                  </div>

                  {/* Flow Diagram (Active Scope Only) */}
                  <div className="mt-8 space-y-6 relative pl-4">
                    {/* Vertical linking line */}
                    <div className="absolute left-[31px] top-6 bottom-6 w-0.5 bg-slate-200 -z-10"></div>

                    {/* Step 1: START Input Ingested */}
                    <div className="flex items-center justify-between bg-slate-50/50 border border-slate-150 rounded-xl p-3.5">
                      <div className="flex items-center gap-4">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${getStageStatus("start") === "completed"
                          ? "bg-emerald-500 text-white"
                          : getStageStatus("start") === "active"
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-200 text-slate-500"
                          }`}>
                          IN
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-700 uppercase font-mono">START</h4>
                          <p className="text-[10px] text-slate-400 font-medium">Input Audio / Notes Uploaded</p>
                        </div>
                      </div>
                      {renderStatusDot(getStageStatus("start"))}
                    </div>

                    {/* Step 2: ORCHESTRATOR */}
                    <div className="flex items-center justify-between bg-slate-50/50 border border-slate-150 rounded-xl p-3.5">
                      <div className="flex items-center gap-4">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${getStageStatus("orchestrator") === "completed"
                          ? "bg-emerald-500 text-white"
                          : getStageStatus("orchestrator") === "active"
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-200 text-slate-500"
                          }`}>
                          ORC
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-700 uppercase font-mono">ORCHESTRATOR</h4>
                          <p className="text-[10px] text-slate-400 font-medium">Pipeline Orchestration Agent</p>
                        </div>
                      </div>
                      {renderStatusDot(getStageStatus("orchestrator"))}
                    </div>

                    {/* Step 3: ANALYST AGENT */}
                    <div className="flex items-center justify-between bg-slate-50/50 border border-slate-150 rounded-xl p-3.5">
                      <div className="flex items-center gap-4">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${getStageStatus("analyst") === "completed"
                          ? "bg-emerald-500 text-white"
                          : getStageStatus("analyst") === "active"
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-200 text-slate-500"
                          }`}>
                          ANA
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-700 uppercase font-mono">ANALYST AGENT</h4>
                          <p className="text-[10px] text-slate-400 font-medium">Whisper transcription + Agile structure</p>
                        </div>
                      </div>
                      {renderStatusDot(getStageStatus("analyst"))}
                    </div>

                    {/* Step 4: REVIEW GATE (Human Checkpoint 1) */}
                    <div className="flex items-center justify-between bg-slate-50/50 border border-slate-150 rounded-xl p-3.5 pl-6 relative">
                      <div className="absolute left-[30px] w-2.5 h-0.5 bg-slate-200 top-1/2"></div>
                      <div className="flex items-center gap-4">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs ${getStageStatus("checkpoint") === "completed"
                          ? "bg-emerald-500 text-white"
                          : getStageStatus("checkpoint") === "active"
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-200 text-slate-500"
                          }`}>
                          GATE
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-700 uppercase font-mono">REVIEW & APPROVE PRD</h4>
                          <p className="text-[10px] text-slate-400 font-medium">Human Checkpoint Gate</p>
                        </div>
                      </div>
                      {renderStatusDot(getStageStatus("checkpoint"))}
                    </div>

                    {/* Step 5: SCRUM AGENT (Azure DevOps Sync) */}
                    <div className="flex items-center justify-between bg-slate-50/50 border border-slate-150 rounded-xl p-3.5">
                      <div className="flex items-center gap-4">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${getStageStatus("scrum") === "completed"
                          ? "bg-emerald-500 text-white"
                          : getStageStatus("scrum") === "active"
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-200 text-slate-500"
                          }`}>
                          SCR
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-700 uppercase font-mono">BACKLOG SYNC</h4>
                          <p className="text-[10px] text-slate-400 font-medium">Azure DevOps REST Integration</p>
                        </div>
                      </div>
                      {renderStatusDot(getStageStatus("scrum"))}
                    </div>
                  </div>
                </div>

                {/* Workflow Activation Footer Button */}
                <div className="pt-6 border-t border-slate-150 mt-6">
                  {pipelineState === "IDLE" || pipelineState === "PREVIEW" ? (
                    <button
                      onClick={submitAudio}
                      disabled={(!audioBlob && !pastedText.trim()) || (!geminiApiKey || !devopsPat || !devopsOrgUrl || !devopsProject)}
                      className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-blue-150 flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.64 8.38l-1.32 1.32m8.59-1.32l-1.32 1.32M9.64 8.38A14.98 14.98 0 001.5 20.5a14.98 14.98 0 0012.12-8.16l1.32-1.32M9.64 8.38L8.32 9.7M12 2.25c-.292 0-.582.008-.87.024A14.98 14.98 0 0118 6.162c0-.29-.008-.58-.024-.87A2.25 2.25 0 0015.75 3H12zm-3 0c.292 0 .582.008.87.024A14.98 14.98 0 006 6.162c0-.29.008-.58.024-.87A2.25 2.25 0 018.25 3H9z" />
                      </svg>
                      {(!geminiApiKey || !devopsPat || !devopsOrgUrl || !devopsProject) ? "Configuration Required" : "Start Automation Pipeline"}
                    </button>
                  ) : (
                    <div className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono py-3">
                      Pipeline execution locked: {pipelineState}
                    </div>
                  )}
                </div>

              </div>

            </div>
          )}

          {/* TAB 2: Agent Studio */}
          {activeTab === "agent-studio" && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm max-w-4xl">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Agent Studio Configurator</h2>
                <p className="text-slate-400 text-xs mt-1">Configure active AI agent system instructions and roles.</p>
              </div>

              <form onSubmit={saveAgentConfigs} className="space-y-6 mt-6">
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                    Analyst Agent (PRD Builder System Prompt)
                  </label>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Instructions for Whisper-to-Agile requirements formatting. Leave empty to use system default prompt instructions.
                  </p>
                  <textarea
                    value={analystPrompt}
                    onChange={(e) => setAnalystPrompt(e.target.value)}
                    placeholder="Enter custom business analyst system prompt instruction details..."
                    className="w-full h-44 bg-slate-50 text-slate-800 font-mono text-xs p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                    Solution Architect Agent (Proposed Technical Solution Prompt)
                  </label>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Defines structure for generated solutions, schema suggestions, API patterns, and mitigation details.
                  </p>
                  <textarea
                    value={solutionPrompt}
                    onChange={(e) => setSolutionPrompt(e.target.value)}
                    placeholder="Enter custom software architect system prompt instruction details..."
                    className="w-full h-44 bg-slate-50 text-slate-800 font-mono text-xs p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setAnalystPrompt("");
                      setSolutionPrompt("");
                      localStorage.removeItem("analyst_prompt");
                      localStorage.removeItem("solution_prompt");
                      alert("Prompts reset to system defaults.");
                    }}
                    className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs border border-slate-200"
                  >
                    Reset Defaults
                  </button>
                  <button
                    type="submit"
                    className="py-2.5 px-5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs shadow-md shadow-blue-100"
                  >
                    Save Agent Config
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: Workflow Library (Workspace Data Aggregation) */}
          {activeTab === "workflow-library" && (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Project Workspace Aggregation Engine</h2>
                  <p className="text-slate-400 text-xs mt-1">
                    Displays structured requirements history, raw transcripts, and details aggregated from pipeline ingestions.
                  </p>
                </div>
                {projectHistory.length > 0 && (
                  <button
                    onClick={clearWorkspaceHistory}
                    className="py-2 px-3 bg-red-50 hover:bg-red-100 text-red-600 font-bold rounded-lg text-xs border border-red-200 transition-all"
                  >
                    Clear Workspace Data
                  </button>
                )}
              </div>

              {selectedHistoryIds.length > 0 && !selectedHistoryItem && (
                <div className="bg-red-50/70 border border-red-200 px-5 py-3.5 rounded-2xl flex items-center justify-between animate-fadeIn shadow-sm shadow-red-50/20">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-red-650 shrink-0">
                      <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-red-800 block leading-tight">Selected {selectedHistoryIds.length} item{selectedHistoryIds.length > 1 ? "s" : ""}</span>
                      <span className="text-[10px] text-red-500 font-medium block mt-0.5">Ready to delete from workspace history</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedHistoryIds([])}
                      className="text-xs text-red-600 hover:text-red-750 hover:underline font-bold px-3 py-1.5 transition-all"
                    >
                      Clear Selection
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="py-2 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs transition-all shadow-md shadow-red-100 flex items-center gap-1.5"
                    >
                      Delete Selected
                    </button>
                  </div>
                </div>
              )}

              {selectedHistoryItem ? (
                /* Detailed view of aggregated PRD/transcript data */
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6">
                  <div className="flex justify-between items-center border-b border-slate-150 pb-4">
                    <div>
                      <button
                        onClick={() => setSelectedHistoryItem(null)}
                        className="text-xs text-indigo-600 hover:underline flex items-center gap-1 font-semibold"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                        </svg>
                        Back to aggregated list
                      </button>
                      <h3 className="text-base font-bold text-slate-800 mt-2">
                        {selectedHistoryItem.devopsTitle || "Aggregated Workspace Requirements"}
                      </h3>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                        Synced Date: {selectedHistoryItem.date} &bull; ID: #{selectedHistoryItem.devopsId || "Local Record"}
                      </p>
                    </div>
                  </div>

                  {selectedHistoryItem.persistedAudioUrl && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                          </svg>
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-slate-700 block">Workspace Audio Record</span>
                          <span className="text-[9px] text-slate-400 block mt-0.5 font-mono">Recorded/Uploaded Voice Input</span>
                        </div>
                      </div>
                      <div className="flex-1 max-w-[300px]">
                        <audio ref={historyPlayerRef} src={`${API_BASE.replace('/api', '')}${selectedHistoryItem.persistedAudioUrl}`} controls className="w-full h-8 rounded bg-transparent" />
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Raw transcript view */}
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col max-h-[350px] overflow-y-auto">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono block mb-2">
                        Raw Input Notes / Transcripts
                      </span>
                      {selectedHistoryItem.segments && selectedHistoryItem.segments.length > 0 ? (
                        <div className="space-y-3 text-left">
                          {selectedHistoryItem.segments.map((seg, idx) => (
                            <div key={seg.id || idx} className="p-2.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-200 hover:shadow-sm transition-all flex flex-col gap-1.5">
                              <div className="flex items-center justify-between text-[10px] font-semibold font-mono">
                                <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">{seg.speaker || "Speaker"}</span>
                                <button 
                                  onClick={() => seekAudioPlayer(timestampToSeconds(seg.start))}
                                  className="text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-100 flex items-center gap-1 transition-all"
                                >
                                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                                  {seg.start || "00:00"}
                                </button>
                              </div>
                              <p className="text-xs text-slate-700 leading-relaxed font-sans">{seg.text}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <textarea
                          readOnly
                          value={selectedHistoryItem.rawTranscript}
                          className="w-full flex-1 min-h-[250px] bg-slate-900 text-slate-200 font-mono text-xs p-3 rounded-lg border border-slate-850 focus:outline-none resize-none"
                        />
                      )}
                    </div>

                    {/* Structured Markdown requirements PRD view */}
                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 max-h-[350px] overflow-y-auto">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono block mb-2">
                        Structured Agile PRD
                      </span>
                      <div
                        className="prose prose-slate prose-xs text-slate-700 max-w-none text-left leading-relaxed prose-headings:text-slate-900 prose-headings:font-bold"
                        dangerouslySetInnerHTML={{ __html: marked.parse(formatCitationsForPreview(selectedHistoryItem.structuredPRD || "*No PRD available.*")) }}
                        onClick={handleContainerClick}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                /* History aggregations list table */
                <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                  {projectHistory.length === 0 ? (
                    <div className="text-center py-16 text-slate-400 space-y-3">
                      <svg className="w-12 h-12 text-slate-300 mx-auto" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25-3v13.5m0-13.5L8.25 7.5m3.75-3l3.75 3M3.75 7.5h16.5" />
                      </svg>
                      <div>
                        <h3 className="text-sm font-bold text-slate-700">No Aggregated Data</h3>
                        <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                          Agreed PRDs, voice transcripts, and syncing files will automatically display here once a run succeeds.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left text-slate-600">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">
                            <th className="p-4 w-12 text-center">
                              <input
                                type="checkbox"
                                checked={projectHistory.length > 0 && selectedHistoryIds.length === projectHistory.length}
                                onChange={handleSelectAll}
                                className="w-4 h-4 rounded border-slate-300 text-indigo-650 focus:ring-indigo-500 cursor-pointer"
                              />
                            </th>
                            <th className="p-4">Timestamp</th>
                            <th className="p-4">Source</th>
                            <th className="p-4">DevOps Ticket</th>
                            <th className="p-4">Status</th>
                            <th className="p-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {projectHistory.map((item) => {
                            const isSelected = selectedHistoryIds.includes(item.id);
                            return (
                              <tr key={item.id} className={`transition-colors hover:bg-slate-50/50 ${isSelected ? "bg-indigo-50/30 hover:bg-indigo-50/50" : ""}`}>
                                <td className="p-4 w-12 text-center">
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => handleToggleSelect(item.id)}
                                    className="w-4 h-4 rounded border-slate-350 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                  />
                                </td>
                                <td className="p-4 font-mono font-semibold text-slate-600">{item.date}</td>
                                <td className="p-4 text-slate-700 font-medium truncate max-w-[200px] flex items-center gap-1.5">
                                  {item.persistedAudioUrl && (
                                    <span className="w-5 h-5 rounded bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0" title="Audio Recording Attached">
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                                      </svg>
                                    </span>
                                  )}
                                  {item.source}
                                </td>
                                <td className="p-4">
                                  {item.devopsId ? (
                                    <span className="text-indigo-600 font-bold">#{item.devopsId}</span>
                                  ) : (
                                    <span className="text-slate-400 font-mono">N/A</span>
                                  )}
                                </td>
                                <td className="p-4">
                                  <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 uppercase tracking-wide font-mono">
                                    {item.status}
                                  </span>
                                </td>
                                <td className="p-4 text-right">
                                  <button
                                    onClick={() => setSelectedHistoryItem(item)}
                                    className="py-1.5 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-lg text-[11px] border border-indigo-100 transition-all"
                                  >
                                    View workspace details
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Custom Delete Confirmation Modal */}
              {showDeleteConfirm && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
                  <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl p-6 text-center space-y-5">
                    <div className="w-12 h-12 bg-red-50 text-red-650 rounded-full flex items-center justify-center mx-auto border border-red-100 shadow-inner">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-lg font-bold text-slate-800">Delete Workspace Records?</h3>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Are you sure you want to permanently delete the selected <strong>{selectedHistoryIds.length}</strong> record(s) from the project history? This action cannot be undone.
                      </p>
                    </div>

                    <div className="flex gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowDeleteConfirm(false)}
                        className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs border border-slate-200 transition-all"
                      >
                        No, Cancel
                      </button>
                      <button
                        type="button"
                        onClick={deleteSelectedHistory}
                        className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs shadow-md shadow-red-100 transition-all"
                      >
                        Yes, Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: DevOps Boards Sync */}
          {activeTab === "devops-sync" && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
                <h2 className="text-lg font-bold text-slate-800">Azure DevOps Backlog Board</h2>
                <p className="text-slate-400 text-xs mt-1">
                  View and manage agile tickets created in Azure DevOps, and access their associated tech solution attachments.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {projectHistory.filter(item => item.devopsId).length === 0 ? (
                  <div className="col-span-full bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400">
                    <svg className="w-10 h-10 text-slate-300 mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12.75 3.03v.568c0 .334.148.65.405.864l.406.34a2.203 2.203 0 001.464.549h.58a2.197 2.197 0 001.62-.705l.225-.25a2.225 2.225 0 011.668-.76h.75a2.25 2.25 0 012.25 2.25v.75c0 .59-.228 1.16-.638 1.586l-.226.236a2.29 2.29 0 00-.63 1.586v.203c0 .263-.092.518-.26.717l-.822.97a2.205 2.205 0 01-1.688.775h-.25a2.2 2.025 0 00-1.8.847l-.142.193a2.201 2.201 0 01-1.785.887h-.726a2.2 2.2 0 00-1.8.847l-.142.193a2.201 2.201 0 01-1.785.887h-.726a2.2 2.2 0 00-1.8.847l-.142.193a2.2 2.2 0 01-1.785.887h-.726a2.25 2.25 0 01-2.25-2.25v-.87c0-.285-.11-.56-.307-.768l-.81-.852a2.25 2.25 0 01-.683-1.6v-.2a2.25 2.25 0 01.683-1.6l.81-.852a2.25 2.25 0 011.666-.768h.273a2.225 2.225 0 001.674-.775l.816-.962a2.23 2.23 0 011.68-.783h.536c.583 0 1.144-.225 1.564-.627l.142-.136a2.27 2.27 0 011.564-.627h.536z" />
                    </svg>
                    <h4 className="text-xs font-bold text-slate-700">No Synced Board Tickets</h4>
                    <p className="text-[10px] text-slate-400 mt-1 max-w-xs mx-auto">
                      All created Azure DevOps work items will appear here as backlog cards with direct links.
                    </p>
                  </div>
                ) : (
                  projectHistory.filter(item => item.devopsId).map((item) => (
                    <div key={item.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between space-y-4">
                      <div>
                        <div className="flex justify-between items-start">
                          <span className="text-[10px] font-bold text-slate-400 font-mono">Work Item</span>
                          <span className="px-2 py-0.5 text-[9px] font-bold font-mono bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-full">
                            #{item.devopsId}
                          </span>
                        </div>
                        <h3 className="text-xs font-bold text-slate-800 mt-2 line-clamp-2 leading-relaxed">
                          {item.devopsTitle || "DevOps Agile Ticket"}
                        </h3>
                        <p className="text-[10px] text-slate-400 font-mono mt-1">Date: {item.date}</p>
                      </div>

                      <div className="pt-3 border-t border-slate-100 space-y-2">
                        {item.proposedSolution && (
                          <button
                            onClick={() => {
                              setProposedSolution(item.proposedSolution);
                              setSuccessInfo({ id: item.devopsId, url: item.devopsUrl, title: item.devopsTitle });
                              setIsViewingSolution(true);
                            }}
                            className="w-full py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold border border-slate-200 rounded-lg text-[10px] transition-all flex items-center justify-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                            View Tech Solution
                          </button>
                        )}
                        <a
                          href={item.devopsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-[10px] transition-all flex items-center justify-center gap-1 shadow-sm shadow-indigo-100"
                        >
                          Open in Azure DevOps
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                          </svg>
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 5: Settings */}
          {activeTab === "settings" && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm max-w-xl">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Platform Global Settings</h2>
                <p className="text-slate-400 text-xs mt-1">Configure active models and target DevOps workspace environments.</p>
              </div>

              {settingsStatus && (
                <div className={`mt-4 p-3 rounded-lg text-xs font-semibold border ${
                  settingsStatus.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-rose-50 text-rose-800 border-rose-200"
                }`}>
                  {settingsStatus.type === "success" ? "✓ " : "✗ "}
                  {settingsStatus.msg}
                </div>
              )}

              <form onSubmit={saveGlobalSettings} className="space-y-4 mt-6">
                {/* --- Google Gemini Section --- */}
                <div className="pt-2 pb-1 border-b border-slate-100">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">Google Gemini API Configuration</h3>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                    Google Gemini API Key
                  </label>
                  <input
                    type="password"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="Enter Google Gemini API Key (GEMINI_API_KEY)..."
                    className="w-full bg-slate-50 text-slate-700 text-xs p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-1"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                    Google Gemini Model Override
                  </label>
                  <select
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    className="w-full bg-slate-50 text-slate-700 text-xs p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                  >
                    <option value="gemini-1.5-flash">gemini-1.5-flash (Standard Fast)</option>
                    <option value="gemini-2.5-flash">gemini-2.5-flash (Advanced Fast)</option>
                    <option value="gemini-1.5-pro">gemini-1.5-pro (High intelligence)</option>
                  </select>
                </div>

                {/* --- Azure DevOps Section --- */}
                <div className="pt-4 pb-1 border-b border-slate-100">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider font-mono">Azure DevOps Integration Settings</h3>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                    Target DevOps Organization URL
                  </label>
                  <input
                    type="text"
                    value={devopsOrgUrl}
                    onChange={(e) => setDevopsOrgUrl(e.target.value)}
                    placeholder="Enter Azure DevOps Organization URL (e.g. https://dev.azure.com/org)..."
                    className="w-full bg-slate-50 text-slate-700 text-xs p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-1"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                    Target DevOps PAT (Personal Access Token)
                  </label>
                  <input
                    type="password"
                    value={devopsPat}
                    onChange={(e) => setDevopsPat(e.target.value)}
                    placeholder="Enter Azure DevOps Personal Access Token (PAT)..."
                    className="w-full bg-slate-50 text-slate-700 text-xs p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-1"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                    Target DevOps Project Name
                  </label>
                  <input
                    type="text"
                    value={devopsProject}
                    onChange={(e) => setDevopsProject(e.target.value)}
                    placeholder="Enter Azure DevOps Project Name..."
                    className="w-full bg-slate-50 text-slate-700 text-xs p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-1"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider font-mono">
                    Target DevOps Work Item Type
                  </label>
                  <select
                    value={devopsWorkItemType}
                    onChange={(e) => setDevopsWorkItemType(e.target.value)}
                    className="w-full bg-slate-50 text-slate-700 text-xs p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                  >
                    <option value="Task">Task</option>
                    <option value="User Story">User Story</option>
                    <option value="Bug">Bug</option>
                    <option value="Epic">Epic</option>
                    <option value="Feature">Feature</option>
                    <option value="Issue">Issue</option>
                  </select>
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    className="py-2.5 px-5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs shadow-md shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {isSavingSettings ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Verifying Connection...
                      </>
                    ) : (
                      "Save Platform Settings"
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

        </main>
      </div>

      {/* Proposed Solution Modal */}
      {isViewingSolution && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden text-left">
            {/* Header */}
            <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
              <div>
                <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.375c.9 0 1.625-.725 1.625-1.625V13.5m4.5-9v13.5a2.25 2.25 0 0 1-2.25 2.25H4.25A2.25 2.25 0 0 1 2 18.25V4.5A2.25 2.25 0 0 1 4.25 2.25h11.25m.75 3 3 3m-3-3v3h3" />
                  </svg>
                  Proposed Technical Solution
                </h3>
                <p className="text-xs text-slate-500 mt-1">AI-generated architecture, schema, API designs and test cases</p>
              </div>
              <button
                onClick={() => { setIsViewingSolution(false); setIsEditingSolution(false); }}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Sub-tabs for Modal (View/Edit) */}
            <div className="px-5 py-2 bg-slate-950/40 border-b border-slate-800 flex gap-2">
              <button
                onClick={() => setIsEditingSolution(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!isEditingSolution ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/20" : "text-slate-500 hover:text-slate-300"}`}
              >
                Preview
              </button>
              <button
                onClick={() => setIsEditingSolution(true)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isEditingSolution ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/20" : "text-slate-500 hover:text-slate-300"}`}
              >
                Edit Solution
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 min-h-[350px]">
              {isEditingSolution ? (
                <textarea
                  value={proposedSolution}
                  onChange={(e) => setProposedSolution(e.target.value)}
                  className="w-full h-full min-h-[300px] bg-slate-950 text-slate-200 font-mono text-xs p-4 rounded-xl border border-slate-800 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none resize-none"
                  placeholder="Edit technical solution..."
                />
              ) : (
                <div
                  className="prose prose-invert prose-xs text-slate-305 max-w-none prose-headings:text-slate-100 prose-a:text-indigo-400"
                  dangerouslySetInnerHTML={{ __html: marked.parse(proposedSolution || "") }}
                ></div>
              )}
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-slate-800 flex justify-between items-center bg-slate-950/20">
              <span className="text-[10px] text-indigo-400/80 font-mono">
                Work Item #{successInfo.id} Attachment
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(proposedSolution);
                    alert("Proposed solution copied to clipboard!");
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition-all border border-slate-700 flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z" />
                  </svg>
                  Copy to Clipboard
                </button>
                <button
                  onClick={() => { setIsViewingSolution(false); setIsEditingSolution(false); }}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs transition-all shadow-lg shadow-indigo-950/20"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="text-center py-6 text-xs text-slate-500 border-t border-slate-200 bg-white">
        <div>AI-Powered Product Delivery Automation Platform &bull; Prototype Vertical Slice</div>
        <div className="mt-1 text-slate-400">Google Gemini STT + Requirements Orchestration + Azure DevOps REST API</div>
      </footer>

    </div>
  );
}