/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  MessageSquare,
  Image as ImageIcon,
  MapPin,
  Send,
  PlusCircle,
  Users,
  Compass,
  User as UserIcon,
  Smile,
  LogOut,
  Camera,
  Layers,
  Map,
  ChevronsRight,
  Sparkles,
  Search,
  Globe,
  Settings,
  Heart,
  Download,
  Eye,
  AlertCircle
} from 'lucide-react';
import { User, Group, Message } from './types.js';
import MapContainer from './components/MapContainer.js';

// Predefined stylish avatar options
const AVATAR_SEEDS = [
  'Buster', 'Coco', 'Gizmo', 'Lucky', 'Rocky', 
  'Scooter', 'Shadow', 'Simba', 'Trigger', 'Wally',
  'Ziggy', 'Milo', 'Bandit', 'Buddy', 'Max'
];

export default function App() {
  // --- Profile Identity & Local State ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileStatus, setProfileStatus] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [isJoined, setIsJoined] = useState(false);

  // --- Chat State Collections ---
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [activeGroupId, setActiveGroupId] = useState('general');
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});

  // --- Dynamic UI State ---
  const [activeTab, setActiveTab] = useState<'chat' | 'photos' | 'radar'>('chat');
  const [inputText, setInputText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomDesc, setNewRoomDesc] = useState('');
  const [fileUploading, setFileUploading] = useState(false);
  const [selectedLightboxImage, setSelectedLightboxImage] = useState<{ url: string; title: string; sender: string } | null>(null);
  const [activeReactionPickerMessageId, setActiveReactionPickerMessageId] = useState<string | null>(null);
  
  // Mobile sidebar toggles
  const [mobileShowRoster, setMobileShowRoster] = useState(false);
  const [mobileShowChannels, setMobileShowChannels] = useState(false);

  // --- Refs ---
  const sseRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<any | null>(null);
  const isTypingStateRef = useRef(false);

  // 1. Initialize custom or persistent user profile
  useEffect(() => {
    let savedUid = localStorage.getItem('unstappe_uid');
    let savedUsername = localStorage.getItem('unstappe_username');
    let savedPhoto = localStorage.getItem('unstappe_photo');
    let savedStatus = localStorage.getItem('unstappe_status') || 'Rollin with the Unstapples ⚡';

    if (!savedUid) {
      savedUid = 'uid-' + Math.random().toString(36).substr(2, 9);
      savedUsername = 'Boy_' + Math.floor(100 + Math.random() * 900);
      savedPhoto = `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(savedUsername)}`;
      
      localStorage.setItem('unstappe_uid', savedUid);
      localStorage.setItem('unstappe_username', savedUsername);
      localStorage.setItem('unstappe_photo', savedPhoto);
      localStorage.setItem('unstappe_status', savedStatus);
    }

    const defaultProfile: User = {
      uid: savedUid,
      username: savedUsername!,
      photoURL: savedPhoto!,
      email: '',
      lastActive: new Date().toISOString(),
      shareLocationEnabled: false,
      statusText: savedStatus,
    };

    setCurrentUser(defaultProfile);
    setProfileName(savedUsername!);
    setProfileAvatar(savedPhoto!);
    setProfileStatus(savedStatus);
  }, []);

  // 2. Establish Real-Time SSE Connection
  useEffect(() => {
    if (!currentUser) return;

    // Register active profile info server-side
    registerUserOnServer(currentUser);

    // Terminate any previous SSE stream
    if (sseRef.current) {
      sseRef.current.close();
    }

    // Connect to EventStream
    const sse = new EventSource(`/api/stream?uid=${currentUser.uid}`);
    sseRef.current = sse;

    sse.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'initial') {
          // Sync server memory db
          const { users: serverUsers, groups: serverGroups, messages: serverMessages } = payload.data;
          setUsers(serverUsers);
          setGroups(serverGroups);
          setMessages(serverMessages);
          
          // Update local copy of profile if modified
          const selfOnServer = serverUsers.find((u: User) => u.uid === currentUser.uid);
          if (selfOnServer) {
            setCurrentUser(selfOnServer);
          }
        } else if (payload.type === 'user_update') {
          const updatedUser = payload.data as User;
          setUsers((prev) => {
            const index = prev.findIndex((u) => u.uid === updatedUser.uid);
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = updatedUser;
              return updated;
            }
            return [...prev, updatedUser];
          });
          if (updatedUser.uid === currentUser.uid) {
            setCurrentUser(updatedUser);
          }
        } else if (payload.type === 'group_created') {
          const newGrp = payload.data as Group;
          setGroups((prev) => {
            if (prev.some((g) => g.id === newGrp.id)) return prev;
            return [...prev, newGrp];
          });
          setMessages((prev) => ({
            ...prev,
            [newGrp.id]: prev[newGrp.id] || [],
          }));
        } else if (payload.type === 'message') {
          const { groupId, message } = payload.data;
          setMessages((prev) => {
            const list = prev[groupId] || [];
            if (list.some((m) => m.id === message.id)) return prev;
            return {
              ...prev,
              [groupId]: [...list, message],
            };
          });
        } else if (payload.type === 'message_reaction') {
          const { groupId, messageId, reactions } = payload.data;
          setMessages((prev) => {
            const list = prev[groupId] || [];
            const updatedList = list.map((m) => {
              if (m.id === messageId) {
                return { ...m, reactions };
              }
              return m;
            });
            return {
              ...prev,
              [groupId]: updatedList,
            };
          });
        } else if (payload.type === 'typing') {
          const { groupId, username, isTyping } = payload.data;
          if (username === currentUser.username) return; // ignore self
          
          setTypingUsers((prev) => {
            const list = prev[groupId] || [];
            if (isTyping) {
              if (list.includes(username)) return prev;
              return { ...prev, [groupId]: [...list, username] };
            } else {
              return { ...prev, [groupId]: list.filter((u) => u !== username) };
            }
          });
        }
      } catch (err) {
        console.error('SSE sync error:', err);
      }
    };

    sse.onerror = (err) => {
      console.warn('SSE disconnected, retrying connection dynamically...', err);
    };

    return () => {
      if (sseRef.current) {
        sseRef.current.close();
      }
    };
  }, [currentUser?.uid]);

  // Keep chat viewport scrolled to bottom on new updates
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages[activeGroupId], activeTab]);

  // Close reaction picker on clicking outside
  useEffect(() => {
    const handleOutsideClick = () => {
      setActiveReactionPickerMessageId(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  // Helpers to register / Sync status
  const registerUserOnServer = (user: User) => {
    fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    })
      .then((r) => r.json())
      .catch((err) => console.error('Register failed', err));
  };

  // Profile Save
  const handleSaveProfile = () => {
    if (!currentUser || !profileName.trim()) return;

    const updated: User = {
      ...currentUser,
      username: profileName.trim(),
      photoURL: profileAvatar,
      statusText: profileStatus,
    };

    localStorage.setItem('unstappe_username', updated.username);
    localStorage.setItem('unstappe_photo', updated.photoURL);
    localStorage.setItem('unstappe_status', updated.statusText || '');

    setCurrentUser(updated);
    registerUserOnServer(updated);
    setIsEditingProfile(false);
    setIsJoined(true);
  };

  // Send Message handler
  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!currentUser || !inputText.trim()) return;

    const payload = {
      groupId: activeGroupId,
      text: inputText.trim(),
      senderId: currentUser.uid,
      senderName: currentUser.username,
      senderPhoto: currentUser.photoURL,
      messageType: 'text',
    };

    fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.json())
      .then(() => {
        setInputText('');
        triggerTypingIndicator(false);
      })
      .catch((err) => console.error('Message failed to transmit', err));
  };

  // Image upload base64 handler
  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    setFileUploading(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      
      // Post to file upload API
      fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64,
          filename: file.name,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.imageUrl) {
            // Post message with image attachment
            const payload = {
              groupId: activeGroupId,
              text: `Shared an image: ${file.name}`,
              senderId: currentUser.uid,
              senderName: currentUser.username,
              senderPhoto: currentUser.photoURL,
              messageType: 'image',
              imageUrl: data.imageUrl,
            };

            fetch('/api/messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            })
              .then((r) => r.json())
              .catch((err) => console.error('Image message trigger failed', err));
          }
        })
        .catch((err) => console.error('Upload process failed', err))
        .finally(() => setFileUploading(false));
    };

    reader.readAsDataURL(file);
  };

  // Sharing location triggers
  const handleShareLocation = (latitude: number, longitude: number) => {
    if (!currentUser) return;

    fetch('/api/users/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: currentUser.uid,
        latitude,
        longitude,
        shareLocationEnabled: true,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          // Post system notification message in current channel
          const payload = {
            groupId: activeGroupId,
            text: `📍 Shared active location benchmark: Lat ${latitude.toFixed(4)}, Lng ${longitude.toFixed(4)}`,
            senderId: currentUser.uid,
            senderName: currentUser.username,
            senderPhoto: currentUser.photoURL,
            messageType: 'location',
            latitude,
            longitude,
            locationName: 'Active Benchmark'
          };

          fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch((err) => console.error(err));
        }
      });
  };

  const handleDisableLocation = () => {
    if (!currentUser) return;

    fetch('/api/users/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uid: currentUser.uid,
        shareLocationEnabled: false,
      }),
    })
      .then((res) => res.json())
      .catch((err) => console.error(err));
  };

  // Create Channel/Room
  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !newRoomName.trim()) return;

    fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newRoomName.trim(),
        description: newRoomDesc.trim(),
        createdBy: currentUser.uid,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setActiveGroupId(data.group.id);
          setIsCreatingRoom(false);
          setNewRoomName('');
          setNewRoomDesc('');
        } else {
          alert(data.error || 'Room creation failed');
        }
      })
      .catch((err) => console.error(err));
  };

  // React to a message (with Optimistic Updates)
  const handleReactToMessage = (messageId: string, emoji: string) => {
    if (!currentUser) return;

    setMessages((prev) => {
      const list = prev[activeGroupId] || [];
      const updatedList = list.map((m) => {
        if (m.id === messageId) {
          const currentReactions = { ...(m.reactions || {}) };
          if (!currentReactions[emoji]) {
            currentReactions[emoji] = [];
          }
          const userIdx = currentReactions[emoji].indexOf(currentUser.uid);
          if (userIdx > -1) {
            currentReactions[emoji].splice(userIdx, 1);
            if (currentReactions[emoji].length === 0) {
              delete currentReactions[emoji];
            }
          } else {
            currentReactions[emoji].push(currentUser.uid);
          }
          return { ...m, reactions: currentReactions };
        }
        return m;
      });
      return { ...prev, [activeGroupId]: updatedList };
    });

    fetch('/api/messages/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: activeGroupId,
        messageId,
        emoji,
        userId: currentUser.uid,
      }),
    })
      .then((r) => r.json())
      .catch((err) => console.error('Reaction sync failure:', err));
  };

  // Typing Feedback debouncers
  const triggerTypingIndicator = (isTyping: boolean) => {
    if (!currentUser) return;
    
    fetch('/api/typing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: activeGroupId,
        username: currentUser.username,
        isTyping,
      }),
    }).catch(() => {});
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    if (!isTypingStateRef.current) {
      isTypingStateRef.current = true;
      triggerTypingIndicator(true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      isTypingStateRef.current = false;
      triggerTypingIndicator(false);
    }, 2000);
  };

  // Helper: Presence status formatting
  const getPresenceColor = (isoString?: string) => {
    if (!isoString) return 'bg-gray-500';
    const last = new Date(isoString).getTime();
    const now = Date.now();
    const diff = now - last;

    if (diff < 5 * 60 * 1000) {
      return 'bg-emerald-500 ring-2 ring-emerald-500/35'; // active 5 mins
    } else if (diff < 20 * 60 * 1000) {
      return 'bg-amber-400'; // idle
    }
    return 'bg-slate-600'; // offline
  };

  // Photo Vault Collection aggregation
  const getAllPhotos = () => {
    const list: { url: string; sender: string; senderPhoto: string; date: string; group: string }[] = [];
    Object.keys(messages).forEach((roomKey) => {
      const roomMsgs = messages[roomKey] || [];
      const grp = groups.find((g) => g.id === roomKey);
      
      roomMsgs.forEach((msg) => {
        if (msg.messageType === 'image' && msg.imageUrl) {
          list.push({
            url: msg.imageUrl,
            sender: msg.senderName,
            senderPhoto: msg.senderPhoto,
            date: msg.createdAt,
            group: grp ? grp.name : 'Unknown Room',
          });
        }
      });
    });
    // Sort youngest first
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  // UI calculations
  const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0];
  const activeRoomMessages = messages[activeGroupId] || [];
  const activeRoomTyping = typingUsers[activeGroupId] || [];
  const currentPhotos = getAllPhotos();

  return (
    <div className="flex flex-col min-h-screen bg-[#070b13] text-gray-200" id="main-chat-viewport">
      {/* --- Top Nav / Brand Header --- */}
      <header className="flex items-center justify-between px-6 py-4 bg-[#0d1527] border-b border-slate-800/80 sticky top-0 z-40">
        <div id="brand-header" className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-white font-extrabold shadow-lg shadow-emerald-900/20">
            ⚡
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white uppercase font-mono flex items-center gap-1.5 leading-none">
              Unstapple Boys <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 rounded-full lowercase font-sans">hub</span>
            </h1>
            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
              {users.length} Active Boys Registered ({users.filter(u => u.shareLocationEnabled).length} on radar)
            </p>
          </div>
        </div>

        {/* --- Top Navigation Tabs --- */}
        <div className="hidden md:flex items-center gap-1.5 bg-slate-950/60 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
              activeTab === 'chat' ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25' : 'text-slate-400 hover:text-white'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Lounge Chat
          </button>
          <button
            onClick={() => setActiveTab('photos')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
              activeTab === 'photos' ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25' : 'text-slate-400 hover:text-white'
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Photo Vault
          </button>
          <button
            onClick={() => setActiveTab('radar')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
              activeTab === 'radar' ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Map className="h-3.5 w-3.5" />
            Boys Radar Map
          </button>
        </div>

        {/* --- Active Member Identity Widget --- */}
        {currentUser && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsEditingProfile(true)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-850 cursor-pointer transition-all group"
            >
              <div className="relative">
                <img
                  src={currentUser.photoURL}
                  className="h-7 w-7 rounded-lg bg-slate-800 object-cover border border-slate-700"
                  alt="avatar"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.src = `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(currentUser.username)}`;
                  }}
                />
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-[#0d1527] animate-pulse" />
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-xs font-bold text-slate-200 group-hover:text-white truncate max-w-[90px]">
                  {currentUser.username}
                </div>
                <div className="text-[9px] text-slate-400 truncate max-w-[90px]">
                  {currentUser.statusText || 'Active Pres'}
                </div>
              </div>
            </button>
          </div>
        )}
      </header>

      {/* --- Mobile Tab Bar Navigation --- */}
      <div className="md:hidden flex items-center justify-around bg-slate-950/90 border-b border-slate-800/80 p-2 text-slate-300">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex flex-col items-center gap-0.5 p-1 text-[11px] font-medium transition-all ${
            activeTab === 'chat' ? 'text-emerald-400 font-bold' : 'text-slate-400'
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          Chat
        </button>
        <button
          onClick={() => setActiveTab('photos')}
          className={`flex flex-col items-center gap-0.5 p-1 text-[11px] font-medium transition-all ${
            activeTab === 'photos' ? 'text-emerald-400 font-bold' : 'text-slate-400'
          }`}
        >
          <ImageIcon className="h-4 w-4" />
          Photos
        </button>
        <button
          onClick={() => setActiveTab('radar')}
          className={`flex flex-col items-center gap-0.5 p-1 text-[11px] font-medium transition-all ${
            activeTab === 'radar' ? 'text-emerald-400 font-bold' : 'text-slate-400'
          }`}
        >
          <Map className="h-4 w-4" />
          Radar
        </button>
      </div>

      {/* --- Main Dashboard Scaffold Grid --- */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* --- LEFT SIDEBAR: Channels/Room Picker --- */}
        <aside
          className={`${
            mobileShowChannels ? 'translate-x-0' : '-translate-x-full'
          } md:translate-x-0 transition-transform duration-250 ease-out fixed md:relative left-0 top-[110px] md:top-0 h-[calc(100vh-110px)] md:h-auto z-30 w-64 shrink-0 bg-[#070b13] border-r border-slate-800 flex flex-col`}
          id="channels-sidebar"
        >
          <div className="p-4 flex items-center justify-between shrink-0 border-b border-slate-800/40">
            <span className="text-xs font-mono font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" />
              Chat Rooms ({groups.length})
            </span>
            <button
              onClick={() => setIsCreatingRoom(true)}
              className="text-emerald-400 hover:text-white transition-colors cursor-pointer"
              title="Create new Room"
            >
              <PlusCircle className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {groups.map((grp) => (
              <button
                key={grp.id}
                onClick={() => {
                  setActiveGroupId(grp.id);
                  setMobileShowChannels(false);
                }}
                className={`w-full flex flex-col text-left px-3.5 py-2.5 rounded-xl cursor-pointer transition-all ${
                  activeGroupId === grp.id
                    ? 'bg-slate-900 border border-slate-800'
                    : 'hover:bg-slate-900/30'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold leading-none ${activeGroupId === grp.id ? 'text-emerald-400' : 'text-slate-300'}`}>
                    #{grp.name}
                  </span>
                  {grp.isDefault && (
                    <span className="text-[9px] text-slate-500 uppercase font-mono font-semibold">default</span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 truncate w-full" title={grp.description}>
                  {grp.description || 'No description active'}
                </p>
              </button>
            ))}
          </div>

          <div className="p-3 bg-slate-950/40 border-t border-slate-800/50 shrink-0 text-center">
            <button
              onClick={() => setIsEditingProfile(true)}
              className="w-full py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900/50 hover:bg-slate-900 text-slate-300 text-xs font-medium cursor-pointer transition-colors"
            >
              Configure Profile
            </button>
          </div>
        </aside>

        {/* Overlay block for mobile sidebar views */}
        {(mobileShowChannels || mobileShowRoster) && (
          <div
            onClick={() => {
              setMobileShowChannels(false);
              setMobileShowRoster(false);
            }}
            className="fixed inset-0 bg-black/60 z-20 md:hidden"
          />
        )}

        {/* --- MIDDLE CHUNK: Active Screen Workspace --- */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#0a0f1d] relative">
          
          {/* Mobile auxiliary headers for quick toggle menus */}
          <div className="md:hidden flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs shrink-0">
            <button
              onClick={() => setMobileShowChannels(!mobileShowChannels)}
              className="text-slate-300 hover:text-emerald-400 flex items-center gap-1.5 cursor-pointer font-medium"
            >
              <Layers className="h-3.5 w-3.5 text-slate-400" />
              Rooms
            </button>
            <span className="text-slate-300 font-bold">
              #{activeGroup?.name || 'Chat'}
            </span>
            <button
              onClick={() => setMobileShowRoster(!mobileShowRoster)}
              className="text-slate-300 hover:text-emerald-400 flex items-center gap-1.5 cursor-pointer font-medium"
            >
              Boys ({users.length})
              <Users className="h-3.5 w-3.5 text-slate-400" />
            </button>
          </div>

          {/* --- VIEW CONTENT SWAPPING --- */}

          {/* TAB 1: Real-time Lounge Chat */}
          {activeTab === 'chat' && (
            <div className="flex-1 flex flex-col justify-between overflow-hidden">
              {/* Channel metadata Banner */}
              <div className="p-4 bg-slate-900/50 border-b border-slate-800/65 flex items-center justify-between shrink-0">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                    <span className="text-slate-500">#</span>
                    {activeGroup?.name}
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[500px]">
                    {activeGroup?.description || 'Boys club community room logs.'}
                  </p>
                </div>
                {/* Embedded quick indicator */}
                <div className="hidden sm:flex items-center gap-1">
                  <span className="bg-slate-950 px-2 py-0.5 rounded text-[10px] text-emerald-400 font-mono">
                    {activeRoomMessages.length} logs
                  </span>
                </div>
              </div>

              {/* Chat messages stream flow container */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4" id="chat-stream-box">
                {activeRoomMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                    <div className="h-10 w-10 rounded-full border border-slate-800 bg-slate-900 flex items-center justify-center text-slate-400 text-lg mb-2">
                      💬
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-wider font-mono text-slate-400">Silent Lounge</p>
                    <p className="text-xs text-slate-500 max-w-[250px] mt-1">This room is empty. Send a message or upload a photo to kick things off!</p>
                  </div>
                ) : (
                  activeRoomMessages.map((msg, idx) => {
                    const isSelf = currentUser && msg.senderId === currentUser.uid;
                    return (
                      <div
                        key={msg.id}
                        className={`flex items-start gap-3.5 max-w-[85%] md:max-w-[70%] ${
                          isSelf ? 'ml-auto flex-row-reverse text-right' : ''
                        }`}
                      >
                        {/* Member Avatar bubble */}
                        <img
                          src={msg.senderPhoto}
                          className="h-8 w-8 rounded-lg bg-slate-800 object-cover border border-slate-700/60 mt-0.5 shrink-0"
                          alt="user avatar"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(msg.senderName)}`;
                          }}
                        />

                        {/* Message payload block style */}
                        <div className={`space-y-1 ${isSelf ? 'text-right' : 'text-left'}`}>
                          <div className={`flex items-center gap-2 text-xs ${isSelf ? 'justify-end' : 'justify-start'}`}>
                            <span className="font-bold text-slate-300 hover:text-white transition-colors cursor-pointer">
                              {msg.senderName}
                            </span>
                            <span className="text-[9px] text-slate-500 font-mono font-medium">
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          {/* Message Content with Smile Button wrapper */}
                          <div className={`flex items-center gap-2 group/msg ${isSelf ? 'flex-row-reverse' : 'flex-row'}`}>
                            {/* Message Bubble */}
                            <div className="max-w-full">
                              {msg.messageType === 'image' ? (
                                <div className="overflow-hidden border border-slate-800/80 bg-slate-900 rounded-xl max-w-sm mt-1 shadow-lg group relative">
                                  <img
                                    src={msg.imageUrl}
                                    className="max-h-60 w-full object-cover rounded-t-xl cursor-zoom-in"
                                    alt="shared capture"
                                    onClick={() => setSelectedLightboxImage({ url: msg.imageUrl!, title: msg.text || 'Capture', sender: msg.senderName })}
                                  />
                                  <div className="p-2 flex items-center justify-between text-[11px] text-slate-300">
                                    <span className="truncate">{msg.text || 'Photo attachment'}</span>
                                    <button 
                                      type="button"
                                      onClick={() => setSelectedLightboxImage({ url: msg.imageUrl!, title: msg.text || 'Capture', sender: msg.senderName })}
                                      className="text-emerald-400 hover:text-emerald-300 font-mono font-bold flex items-center gap-0.5"
                                    >
                                      View <Eye className="w-3 h-3 inline" />
                                    </button>
                                  </div>
                                </div>
                              ) : msg.messageType === 'location' ? (
                                <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/15 max-w-sm mt-1 text-left">
                                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 mb-1">
                                    <MapPin className="h-4 w-4" />
                                    <span>Radar Coordinates</span>
                                  </div>
                                  <p className="text-[11px] text-gray-300">
                                    {msg.text}
                                  </p>
                                  {msg.latitude && msg.longitude && (
                                    <div className="mt-2 pt-2 border-t border-emerald-900/40 flex items-center justify-between">
                                      <span className="text-[10px] font-mono text-emerald-500">
                                        LAT: {msg.latitude.toFixed(4)} • LNG: {msg.longitude.toFixed(4)}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setActiveTab('radar');
                                        }}
                                        className="text-[10px] font-semibold text-emerald-400 hover:underline cursor-pointer"
                                      >
                                        Focus Radar →
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                // Standard Text bubble
                                <div
                                  className={`px-3.5 py-2.5 rounded-2xl text-xs md:text-sm leading-relaxed ${
                                    isSelf
                                      ? 'bg-emerald-500 text-slate-950 font-medium rounded-tr-none'
                                      : 'bg-[#1b253b] text-slate-100 rounded-tl-none'
                                  }`}
                                >
                                  <span className="break-words inline-block text-left w-full">
                                    {msg.text}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Small Quick Smile Button picker trigger */}
                            <div className="relative shrink-0 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity duration-200">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveReactionPickerMessageId(
                                    activeReactionPickerMessageId === msg.id ? null : msg.id
                                  );
                                }}
                                className="p-1 rounded-full text-slate-500 hover:text-slate-300 hover:bg-slate-900/60 transition-all cursor-pointer"
                                title="React"
                              >
                                <Smile className="h-4 w-4" />
                              </button>

                              {activeReactionPickerMessageId === msg.id && (
                                <div
                                  className={`absolute z-30 bottom-full mb-1.5 p-1 bg-slate-950 border border-slate-800 rounded-xl shadow-xl flex items-center gap-1 animate-in fade-in zoom-in-95 duration-150 ${
                                    isSelf ? 'right-0' : 'left-0'
                                  }`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {['❤️', '👍', '🔥', '😂', '🎉', '😮'].map((emoji) => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      onClick={() => {
                                        handleReactToMessage(msg.id, emoji);
                                        setActiveReactionPickerMessageId(null);
                                      }}
                                      className="w-7 h-7 flex items-center justify-center text-base rounded-lg hover:bg-slate-800 cursor-pointer active:scale-90 transition-transform select-none"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Render active reactions list under bubble */}
                          {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                            <div className={`mt-1 flex flex-wrap gap-1.5 ${isSelf ? 'justify-end' : 'justify-start'}`}>
                              {Object.entries(msg.reactions).map(([emoji, rawVal]) => {
                                const userIds = rawVal as string[];
                                if (!userIds || userIds.length === 0) return null;
                                const hasMyReaction = currentUser && userIds.includes(currentUser.uid);

                                // Find user nicknames for tooltips
                                const reactorNames = userIds
                                  .map(uid => users.find(u => u.uid === uid)?.username || 'Someone')
                                  .join(', ');

                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => handleReactToMessage(msg.id, emoji)}
                                    title={reactorNames}
                                    className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs transition-all cursor-pointer select-none border ${
                                      hasMyReaction
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-semibold'
                                        : 'bg-[#121c30] border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                                    }`}
                                  >
                                    <span className="text-sm leading-none">{emoji}</span>
                                    <span className="text-[10px] leading-none">{userIds.length}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Real-time typing loop placeholder */}
                {activeRoomTyping.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 italic font-medium px-4 py-2 bg-slate-900/40 rounded-xl max-w-xs animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    <span>
                      {activeRoomTyping.join(', ')} {activeRoomTyping.length === 1 ? 'is' : 'are'} typing...
                    </span>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input action container box */}
              <div className="p-4 bg-slate-900/40 border-t border-slate-800/80 shrink-0 select-none">
                <form onSubmit={handleSendMessage} className="flex items-center gap-2 relative">
                  
                  {/* Plus menu / Image file selection */}
                  <label
                    htmlFor="dialog-image-file"
                    className="h-9 w-9 rounded-xl border border-slate-800 bg-slate-900 hover:bg-slate-850 hover:border-slate-700 flex items-center justify-center text-slate-400 hover:text-emerald-400 cursor-pointer transition-colors relative"
                    title="Share active Photo"
                  >
                    <Camera className="h-4 w-4" />
                    {fileUploading && (
                      <span className="absolute inset-0 bg-slate-900/80 rounded-xl flex items-center justify-center">
                        <span className="w-3.5 h-3.5 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                      </span>
                    )}
                  </label>
                  <input
                    type="file"
                    id="dialog-image-file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageFileChange}
                    disabled={fileUploading}
                  />

                  {/* Input field */}
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      className="w-full h-10 px-4 pr-10 rounded-xl bg-slate-950 border border-slate-800 text-xs focus:outline-none focus:border-emerald-500/50 text-slate-100 placeholder-slate-500"
                      placeholder={`Send a message to #${activeGroup?.name}...`}
                      value={inputText}
                      onChange={handleInputChange}
                      maxLength={400}
                    />
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-600 font-mono">
                        {inputText.length}/400
                      </span>
                    </div>
                  </div>

                  {/* Send Action */}
                  <button
                    type="submit"
                    disabled={!inputText.trim()}
                    className="h-10 w-10 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500 text-slate-950 flex items-center justify-center cursor-pointer transition-all active:scale-95 shadow-lg shadow-emerald-500/10"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>

                {/* Helpful prompt hint */}
                <span className="text-[10px] text-slate-500 mt-2 block text-left">
                  Tips: Use the radar tab above to synchronize locations collaboratively.
                </span>
              </div>
            </div>
          )}

          {/* TAB 2: Photo Vault Gallery */}
          {activeTab === 'photos' && (
            <div className="flex-1 flex flex-col justify-between overflow-hidden p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/60 pb-4 mb-6 shrink-0">
                <div>
                  <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-emerald-400" />
                    Unstapple Photo Vault
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Browse visual clips, raw boards, and media moments captured by the 100 member roster.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[10px] bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800">
                  <span className="text-emerald-400 font-bold">{currentPhotos.length}</span> RAW SHOTS ACTIVE
                </div>
              </div>

              {/* Photo Masonry grid */}
              <div className="flex-1 overflow-y-auto pr-1">
                {currentPhotos.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                    <ImageIcon className="h-12 w-12 text-slate-600 mb-2" />
                    <p className="text-xs font-semibold uppercase tracking-wider font-mono text-slate-400">Vault Empty</p>
                    <p className="text-xs text-slate-500 mt-1">No pictures have been uploaded to Unstapple Boys server yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pb-6">
                    {currentPhotos.map((photo, i) => (
                      <div
                        key={i}
                        className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900 cursor-zoom-in hover:border-emerald-500/40 shadow-md relative"
                        onClick={() => setSelectedLightboxImage({ url: photo.url, title: `Snapshot from #${photo.group}`, sender: photo.sender })}
                      >
                        <img
                          src={photo.url}
                          photo-idx={i}
                          className="h-40 w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          alt="vault snapshot"
                        />
                        {/* Overlay info */}
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity p-2 flex flex-col justify-end text-left">
                          <span className="text-[10px] font-bold text-white truncate">{photo.sender}</span>
                          <span className="text-[9px] text-slate-300 truncate">#{photo.group}</span>
                        </div>
                        {/* Static quick view bar */}
                        <div className="p-2 bg-slate-950/70 border-t border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                          <span className="truncate max-w-[80px]">{photo.sender}</span>
                          <span className="text-[8px] font-mono">
                            {new Date(photo.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Radar Location sharing maps */}
          {activeTab === 'radar' && currentUser && (
            <div className="flex-1 p-6 overflow-hidden flex flex-col justify-between">
              <MapContainer
                users={users}
                currentUserId={currentUser.uid}
                onShareLocation={handleShareLocation}
                onDisableLocation={handleDisableLocation}
                isSharing={currentUser.shareLocationEnabled}
              />
            </div>
          )}
        </main>

        {/* --- RIGHT SIDEBAR: Member Presence roster directory --- */}
        <aside
          className={`${
            mobileShowRoster ? 'translate-x-0' : 'translate-x-full'
          } md:translate-x-0 transition-transform duration-250 ease-out fixed md:relative right-0 top-[110px] md:top-0 h-[calc(100vh-110px)] md:h-auto z-30 w-64 shrink-0 bg-[#070b13] border-l border-slate-800 flex flex-col`}
          id="roster-sidebar"
        >
          {/* Header */}
          <div className="p-4 bg-slate-950/40 border-b border-slate-800/40 flex items-center justify-between shrink-0">
            <span className="text-xs font-mono font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              Boys List ({users.length})
            </span>
          </div>

          {/* Member Search input */}
          <div className="p-3 border-b border-slate-800/30 shrink-0 bg-slate-950/20">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-slate-500" />
              <input
                type="text"
                className="w-full text-[11px] h-8 pl-8 pr-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/40"
                placeholder="Roster search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* List layout */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {users
              .filter((u) => u.username.toLowerCase().includes(searchQuery.toLowerCase()))
              .map((u) => {
                const isActive = getPresenceColor(u.lastActive).includes('emerald');
                return (
                  <div
                    key={u.uid}
                    className="flex items-center justify-between p-2 rounded-xl border border-slate-800/40 bg-slate-900/10 hover:bg-slate-900/40 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="relative shrink-0">
                        <img
                          src={u.photoURL}
                          className="h-8 w-8 rounded-lg bg-slate-800 object-cover border border-slate-700/85"
                          alt="user"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(u.username)}`;
                          }}
                        />
                        <span className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-slate-950 ${getPresenceColor(u.lastActive)}`} />
                      </div>
                      <div className="min-w-0 text-left">
                        <div className="text-xs font-bold text-slate-100 truncate flex items-center gap-1">
                          {u.username}
                          {u.uid === currentUser?.uid && (
                            <span className="text-[8px] text-emerald-400 font-mono font-medium">(you)</span>
                          )}
                        </div>
                        <div className="text-[9px] text-slate-400 truncate max-w-[130px]">
                          {u.statusText || 'Offline / Hanging out'}
                        </div>
                      </div>
                    </div>

                    {/* Quick radar share beacon indication */}
                    {u.shareLocationEnabled && u.latitude && u.longitude && (
                      <button
                        onClick={() => {
                          setActiveTab('radar');
                          setMobileShowRoster(false);
                        }}
                        className="p-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 cursor-pointer"
                        title="Locate on Radar Map"
                      >
                        <MapPin className="h-3 w-3 text-emerald-400" />
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        </aside>

      </div>

      {/* --- MODAL 1: Create Custom Channel Space --- */}
      {isCreatingRoom && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateRoom}
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4 shadow-2xl relative"
          >
            <div className="space-y-1 text-left">
              <h3 className="text-sm font-extrabold text-white uppercase tracking-tight font-mono">
                Launch Boyz Room
              </h3>
              <p className="text-xs text-slate-400">
                Create a distinct sub-channel group for events or custom chats.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1 text-left">
                <label className="text-[10px] font-mono text-slate-400 font-bold uppercase">Room Name</label>
                <input
                  type="text"
                  required
                  rows={1}
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs focus:outline-none focus:border-emerald-500 text-slate-200"
                  placeholder="e.g. boys-weekend, memes"
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  maxLength={24}
                />
              </div>

              <div className="space-y-1 text-left">
                <label className="text-[10px] font-mono text-slate-400 font-bold uppercase">Purpose/Description</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs focus:outline-none focus:border-emerald-500 text-slate-300"
                  placeholder="What is this channel about..."
                  value={newRoomDesc}
                  onChange={(e) => setNewRoomDesc(e.target.value)}
                  maxLength={60}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCreatingRoom(false)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl bg-slate-950 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 text-xs font-semibold rounded-xl bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-all cursor-pointer shadow-lg shadow-emerald-500/10"
              >
                Launch Room
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODAL 2: Profile Settings Drawer Overlay --- */}
      {isEditingProfile && (
        <div className="fixed inset-0 bg-black/85 z-55 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#0f172a] border border-slate-800 p-6 space-y-4 shadow-2xl relative">
            <div className="space-y-1 text-left">
              <h3 className="text-sm font-bold text-white uppercase tracking-tight font-mono flex items-center gap-1.5">
                <Settings className="w-4 h-4 text-emerald-400" />
                Unstapple Identity Config
              </h3>
              <p className="text-xs text-slate-400">
                Setup your display name, statuses and custom avatars.
              </p>
            </div>

            <div className="space-y-4">
              {/* Profile Name */}
              <div className="space-y-1 text-left">
                <label className="text-[10px] font-mono text-slate-400 font-bold uppercase text-left">Nickname</label>
                <input
                  type="text"
                  required
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs focus:outline-none focus:border-emerald-400 text-slate-200"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  maxLength={18}
                />
              </div>

              {/* Status text */}
              <div className="space-y-1 text-left">
                <label className="text-[10px] font-mono text-slate-400 font-bold uppercase">Custom Status Lines</label>
                <input
                  type="text"
                  className="w-full h-10 px-3 rounded-xl bg-slate-950 border border-slate-800 text-xs focus:outline-none focus:border-emerald-400 text-slate-200 animate-none"
                  value={profileStatus}
                  onChange={(e) => setProfileStatus(e.target.value)}
                  maxLength={50}
                />
              </div>

              {/* Avatar Selector Presets */}
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-mono text-slate-400 font-bold uppercase">Pick an Avatar Preset</label>
                <div className="grid grid-cols-5 gap-2 bg-slate-950/50 p-2.5 rounded-xl border border-slate-800">
                  {AVATAR_SEEDS.map((seed) => {
                    const url = `https://api.dicebear.com/7.x/pixel-art/svg?seed=${encodeURIComponent(seed)}`;
                    const isSelected = profileAvatar === url;
                    return (
                      <button
                        key={seed}
                        type="button"
                        onClick={() => setProfileAvatar(url)}
                        className={`h-9 w-9 rounded-lg overflow-hidden border-2 cursor-pointer transition-all ${
                          isSelected ? 'border-emerald-500 scale-105 shadow shadow-emerald-500' : 'border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <img src={url} className="h-full w-full object-cover" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditingProfile(false)}
                className="flex-1 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-950/60 hover:bg-slate-900 text-slate-400 text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                className="flex-1 py-1.5 rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 text-xs font-bold transition-all cursor-pointer shadow-lg shadow-emerald-500/10"
              >
                Save Identity
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- LIGHTBOX: Img Modal zoom --- */}
      {selectedLightboxImage && (
        <div
          className="fixed inset-0 bg-black/95 z-60 flex flex-col items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setSelectedLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[85vh] overflow-hidden rounded-xl border border-slate-800 select-none">
            <img src={selectedLightboxImage.url} className="max-w-full max-h-[85vh] object-contain" />
          </div>
          <div className="text-center mt-3 text-xs text-slate-300">
            <p className="font-bold text-white">{selectedLightboxImage.title}</p>
            <p className="text-slate-400 text-[10px] mt-0.5">Uploaded by {selectedLightboxImage.sender}</p>
          </div>
        </div>
      )}
    </div>
  );
}
