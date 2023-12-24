"use client";
import { useEffect, useRef, useState } from "react";
import ImageUpload from "./components/ImageUpload";
import CodePreview from "./components/CodePreview";
import Preview from "./components/Preview";
import { CodeGenerationParams, generateCode } from "./generateCode";
import Spinner from "./components/Spinner";
import classNames from "classnames";
import {
  FaCode,
  FaDesktop,
  FaDownload,
  FaMobile,
  FaUndo,
  FaCloudUploadAlt,
} from "react-icons/fa";

import { Switch } from "./components/ui/switch";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import SettingsDialog from "./components/SettingsDialog";
import { Settings, EditorTheme, AppState, GeneratedCodeConfig } from "./types";
import { IS_RUNNING_ON_CLOUD } from "./config";
import OnboardingNote from "./components/OnboardingNote";
import { usePersistedState } from "./hooks/usePersistedState";
// import { UrlInputSection } from "./components/UrlInputSection";
import html2canvas from "html2canvas";
import { USER_CLOSE_WEB_SOCKET_CODE } from "./constants";
import CodeTab from "./components/CodeTab";
import OutputSettingsSection from "./components/OutputSettingsSection";
import { History } from "./components/history/history_types";
import HistoryDisplay from "./components/history/HistoryDisplay";
import { extractHistoryTree } from "./components/history/utils";
import toast from "react-hot-toast";
import PromptPanel from './components/PromptPanel';

import Whiteboard from './components/Whiteboard';
import NativePreview from './components/NativeMobile';

const IS_OPENAI_DOWN = false;

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.INITIAL);
  const [generatedCode, setGeneratedCode] = useState<string>("");

  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [executionConsole, setExecutionConsole] = useState<string[]>([]);
  const [updateInstruction, setUpdateInstruction] = useState("");
  const [showImageUpload, setShowImageUpload] = useState<boolean>(true);
  const [showPreview, setShowPreview] = useState<boolean>(true);

  // Settings
  const [settings, setSettings] = usePersistedState<Settings>(
    {
      openAiApiKey: null,
      openAiBaseURL: null,
      screenshotOneApiKey: null,
      isImageGenerationEnabled: true,
      editorTheme: EditorTheme.COBALT,
      generatedCodeConfig: GeneratedCodeConfig.HTML_TAILWIND,
      // Only relevant for hosted version
      isTermOfServiceAccepted: false,
      accessCode: null,
      mockAiResponse: false,
      promptCode: '',
    },
    "setting"
  );

  // App history
  const [appHistory, setAppHistory] = useState<History>([]);
  // Tracks the currently shown version from app history
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);

  const [shouldIncludeResultImage, setShouldIncludeResultImage] =
    useState<boolean>(false);

  const wsRef = useRef<WebSocket>(null);

  // When the user already has the settings in local storage, newly added keys
  // do not get added to the settings so if it's falsy, we populate it with the default
  // value
  useEffect(() => {
    if (!settings.generatedCodeConfig) {
      setSettings((prev) => ({
        ...prev,
        generatedCodeConfig: GeneratedCodeConfig.HTML_TAILWIND,
      }));
    }
    
  }, [settings.generatedCodeConfig, setSettings]);

  const takeScreenshot = async (): Promise<string> => {
    const iframeElement = document.querySelector(
      "#preview-desktop"
    ) as HTMLIFrameElement;
    if (!iframeElement?.contentWindow?.document.body) {
      return "";
    }

    const canvas = await html2canvas(iframeElement.contentWindow.document.body);
    const png = canvas.toDataURL("image/png");
    return png;
  };

  const downloadCode = () => {
    // Create a blob from the generated code
    const blob = new Blob([generatedCode], { type: "text/html" });
    const url = URL.createObjectURL(blob);

    // Create an anchor element and set properties for download
    const a = document.createElement("a");
    a.href = url;
    a.download = "index.html"; // Set the file name for download
    document.body.appendChild(a); // Append to the document
    a.click(); // Programmatically click the anchor to trigger download

    // Clean up by removing the anchor and revoking the Blob URL
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setAppState(AppState.INITIAL);
    setGeneratedCode("");
    setReferenceImages([]);
    setExecutionConsole([]);
    setAppHistory([]);
  };

  const stop = () => {
    wsRef.current?.close?.(USER_CLOSE_WEB_SOCKET_CODE);
    // make sure stop can correct the state even if the websocket is already closed
    setAppState(AppState.CODE_READY);
  };

  function doGenerateCode(
    params: CodeGenerationParams,
    parentVersion: number | null
  ) {
    setExecutionConsole([]);
    setAppState(AppState.CODING);

    // Merge settings with params
    const updatedParams = { ...params, ...settings };

    generateCode(
      wsRef,
      updatedParams,
      (token) => setGeneratedCode((prev) => prev + token),
      (code) => {
        setGeneratedCode(code);
        if (params.generationType === "create") {
          setAppHistory([
            {
              type: "ai_create",
              parentIndex: null,
              code,
              inputs: { image_url: referenceImages[0] },
            },
          ]);
          setCurrentVersion(0);
        } else {
          setAppHistory((prev) => {
            // Validate parent version
            if (parentVersion === null) {
              toast.error(
                "No parent version set. Contact support or open a Github issue."
              );
              return prev;
            }

            const newHistory: History = [
              ...prev,
              {
                type: "ai_edit",
                parentIndex: parentVersion,
                code,
                inputs: {
                  prompt: updateInstruction,
                },
              },
            ];
            setCurrentVersion(newHistory.length - 1);
            return newHistory;
          });
        }
      },
      (line) => setExecutionConsole((prev) => [...prev, line]),
      () => {
        setAppState(AppState.CODE_READY);
      }
    );
  }

  // Initial version creation
  function doCreate(referenceImages: string[]) {
    // Reset any existing state
    reset();

    setReferenceImages(referenceImages);
    if (referenceImages.length > 0) {
      doGenerateCode(
        {
          generationType: "create",
          image: referenceImages[0],
        },
        currentVersion
      );
    }
  }

  // Subsequent updates
  async function doUpdate() {
    if (currentVersion === null) {
      toast.error(
        "No current version set. Contact support or open a Github issue."
      );
      return;
    }

    const updatedHistory = [
      ...extractHistoryTree(appHistory, currentVersion),
      updateInstruction,
    ];

    if (shouldIncludeResultImage) {
      const resultImage = await takeScreenshot();
      doGenerateCode(
        {
          generationType: "update",
          image: referenceImages[0],
          resultImage: resultImage,
          history: updatedHistory,
        },
        currentVersion
      );
    } else {
      doGenerateCode(
        {
          generationType: "update",
          image: referenceImages[0],
          history: updatedHistory,
        },
        currentVersion
      );
    }

    setGeneratedCode("");
    setUpdateInstruction("");
  }


  return (
    <div className="mt-2 dark:bg-black dark:text-white h-full">
      <div className="lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-96 lg:flex-col">
        <div className="flex grow flex-col gap-y-2 overflow-y-auto border-r border-gray-200 bg-white px-6 dark:bg-zinc-950 dark:text-white">
          <div className="flex items-center justify-between mt-5 mb-2">
            <h1 className="text-2xl ">Ant CodeAI</h1>
            <div className="flex">
            {appState === AppState.CODE_READY && (
              <>
                <span
                    onClick={reset}
                    className="hover:bg-slate-200 p-2 rounded-sm"                  >
                    <FaUndo />
                    {/* Reset */}
                </span>
                <span
                  onClick={downloadCode}
                  className="hover:bg-slate-200 p-2 rounded-sm"
                >
                  <FaDownload />
                </span>
              </>
          
            )}
              <SettingsDialog settings={settings} setSettings={setSettings} />
            </div>
          </div>
     
          <OutputSettingsSection
            generatedCodeConfig={settings.generatedCodeConfig}
            setGeneratedCodeConfig={(config: GeneratedCodeConfig) =>
              setSettings((prev) => ({
                ...prev,
                generatedCodeConfig: config,
              }))
            }
            shouldDisableUpdates={
              appState === AppState.CODING || appState === AppState.CODE_READY
            }
          />

          {IS_OPENAI_DOWN && (
            <div className="bg-black text-white dark:bg-white dark:text-black p-3 rounded">
              OpenAI API is currently down. Try back in 30 minutes or later. We
              apologize for the inconvenience.
            </div>
          )}

          {(appState === AppState.CODING ||
            appState === AppState.CODE_READY) && (
            <>
              {/* Show code preview only when coding */}
              {appState === AppState.CODING && (
                <div className="flex flex-col">
                  <div className="flex items-center gap-x-1">
                    <Spinner />
                    {executionConsole.slice(-1)[0]}
                  </div>
                  <div className="flex mt-4 w-full">
                    <Button
                      onClick={stop}
                      className="w-full dark:text-white dark:bg-gray-700"
                    >
                      Stop
                    </Button>
                  </div>
                  <CodePreview code={generatedCode} />
                </div>
              )}

              {appState === AppState.CODE_READY && (
                <div>
                  <div className="grid w-full gap-2">
                    <Textarea
                      placeholder="Tell the AI what to change..."
                      onChange={(e) => setUpdateInstruction(e.target.value)}
                      value={updateInstruction}
                    />
                    <div className="flex justify-between items-center gap-x-2">
                      <div className="font-500 text-xs text-slate-700 dark:text-white">
                        Include screenshot of current version?
                      </div>
                      <Switch
                        checked={shouldIncludeResultImage}
                        onCheckedChange={setShouldIncludeResultImage}
                        className="dark:bg-gray-700"
                      />
                    </div>
                    <Button
                      onClick={doUpdate}
                      className="dark:text-white dark:bg-gray-700"
                    >
                      Update
                    </Button>
                  </div>
                </div>
              )}

              {/* Reference image display */}
              <div className="flex gap-x-2 mt-2">
                <div className="flex flex-col">
                  <div
                    className={classNames({
                      "scanning relative": appState === AppState.CODING,
                    })}
                  >
                    <img
                      className="w-[340px] border border-gray-200 rounded-md"
                      src={referenceImages[0]}
                      alt="Reference"
                    />
                  </div>
                  <div className="text-gray-400 uppercase text-sm text-center mt-1">
                    Original Screenshot
                  </div>
                </div>
                <div className="bg-gray-400 px-4 py-2 rounded text-sm hidden">
                  <h2 className="text-lg mb-4 border-b border-gray-800">
                    Console
                  </h2>
                  {executionConsole.map((line, index) => (
                    <div
                      key={index}
                      className="border-b border-gray-400 mb-2 text-gray-600 font-mono"
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          <PromptPanel settings={settings} setSettings={setSettings} />
          {
            <HistoryDisplay
              history={appHistory}
              currentVersion={currentVersion}
              revertToVersion={(index) => {
                if (
                  index < 0 ||
                  index >= appHistory.length ||
                  !appHistory[index]
                )
                  return;
                setCurrentVersion(index);
                setGeneratedCode(appHistory[index].code);
              }}
              shouldDisableReverts={appState === AppState.CODING}
            />
          }
        </div>
      </div>

      <main className="lg:ml-96 relative h-full">
        {appState === AppState.INITIAL && (
          <div className="h-full" onClick={() => {
            setShowImageUpload(false);
          }}>
            <Whiteboard doCreate={doCreate}/>
          </div>
        )}
        {
          appState === AppState.INITIAL && (
            <div className="absolute top-20 right-10 z-[10]">
              <div  
                onClick={() => setShowImageUpload(!showImageUpload)}
                className="flex justify-center items-center w-12 h-12 rounded-full ring-2 ring-gray-900 hover:bg-slate-200 text-gray-800 size-2 mb-2"
              >
                <FaCloudUploadAlt />
              </div>
            </div>
          )
        }
        {appState === AppState.INITIAL && (
          <div className={classNames(
            "absolute left-[50%] -ml-[300px] z-[10] flex flex-col justify-center items-center gap-y-10 w-[600px] top-32",
            {"hidden": !showImageUpload}
          )}>
            <ImageUpload setReferenceImages={doCreate} />
            {/* <UrlInputSection
              doCreate={doCreate}
              screenshotOneApiKey={settings.screenshotOneApiKey}
            /> */}
          </div>
        )}

        {(appState === AppState.CODING || appState === AppState.CODE_READY) && showPreview && (
          <div className="ml-4 absolute top-5 z-[10] w-[80%] ml-[10%]">
            <Tabs defaultValue={settings.generatedCodeConfig == GeneratedCodeConfig.REACT_NATIVE ? 'native' : 'desktop'}>
              <div className="flex justify-end mr-8 mb-4">
                <TabsList>
                  {
                    settings.generatedCodeConfig === GeneratedCodeConfig.REACT_NATIVE ? (
                      <TabsTrigger value="native" className="flex gap-x-2">
                      <FaDesktop /> native Mobile
                    </TabsTrigger>
                    ) : (
                      <>
                        <TabsTrigger value="desktop" className="flex gap-x-2">
                          <FaDesktop /> Desktop
                        </TabsTrigger>
                        <TabsTrigger value="mobile" className="flex gap-x-2">
                          <FaMobile /> Mobile
                        </TabsTrigger>
                      </>
                    )
                  }
                  <TabsTrigger value="code" className="flex gap-x-2">
                    <FaCode />
                    Code
                  </TabsTrigger>
                </TabsList>
              </div>
              {
                settings.generatedCodeConfig === GeneratedCodeConfig.REACT_NATIVE ? (
                  <TabsContent value="native">
                    <NativePreview code={generatedCode} appState={appState}/>
                  </TabsContent>
                ) : (
                  <>
                    <TabsContent value="desktop">
                      <Preview code={generatedCode} device="desktop" />
                    </TabsContent>
                    <TabsContent value="mobile">
                      <Preview code={generatedCode} device="mobile" />
                    </TabsContent>
                  </>
                )
              }
              <TabsContent value="code">
                <CodeTab
                  code={generatedCode}
                  setCode={setGeneratedCode}
                  settings={settings}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
      {
        IS_RUNNING_ON_CLOUD &&
        !(settings.openAiApiKey) && (
          <div className="fixed left-[20px] bottom-[20px] z-[1000]">
            <OnboardingNote />
          </div>
        )
      }
     
    </div>
  );
}

export default App;
