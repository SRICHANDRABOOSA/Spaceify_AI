import { useNavigate, useOutletContext, useParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import { generate3DView } from "../../lib/ai.action";
import { Box, Download, RefreshCcw, X } from "lucide-react";
import Button from "../../components/ui/Button";
import { createProject, getProjectById } from "../../lib/puter.action";
import {
  ReactCompareSlider,
  ReactCompareSliderImage,
} from "react-compare-slider";
import { PROGRESS_STEP } from "../../lib/Constants";

export default function Visualizer() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { userId } = useOutletContext<AuthContext>();

  const hasInitialGenerated = useRef(false);

  const [project, setProject] = useState<DesignItem | null>(null);
  const [isProjectLoading, setIsProjectLoading] = useState(true);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const processingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const clearProcessingInterval = () => {
    if (processingIntervalRef.current) {
      clearInterval(processingIntervalRef.current);
      processingIntervalRef.current = null;
    }
  };

  const getProcessingLabel = (progress: number) => {
    if (progress < 35) return "Analyzing floor plan...";
    if (progress < 75) return "Generating your 3D visualization...";
    if (progress < 100) return "Finalizing render and saving project...";
    return "Done.";
  };

  const handleBack = () => navigate("/");

  const getExportExtension = (src: string) => {
    const dataMatch = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);/);
    if (dataMatch) return dataMatch[1].split("/")[1];
    try {
      const { pathname } = new URL(src, window.location.href);
      const ext = pathname.split(".").pop();
      return ext || "png";
    } catch {
      return "png";
    }
  };

  const handleExport = () => {
    if (!currentImage) return;

    const link = document.createElement("a");
    link.href = currentImage;
    const ext = getExportExtension(currentImage);
    link.download = `roomify-render-${id || "new"}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const runGeneration = async (item: DesignItem) => {
    if (!id || !item.sourceImage) return;

    try {
      setIsProcessing(true);
      setProcessingProgress(8);

      clearProcessingInterval();
      processingIntervalRef.current = setInterval(() => {
        setProcessingProgress((prev) => {
          if (prev >= 92) return prev;
          return Math.min(prev + PROGRESS_STEP, 92);
        });
      }, 350);

      const result = await generate3DView({ sourceImage: item.sourceImage });
      setProcessingProgress((prev) => Math.max(prev, 80));

      if (result.renderedImage) {
        setCurrentImage(result.renderedImage);

        const updatedItem = {
          ...item,
          renderedImage: result.renderedImage,
          renderedPath: result.renderedPath,
          timestamp: Date.now(),
          ownerId: item.ownerId ?? userId ?? null,
          isPublic: item.isPublic ?? false,
        };

        const saved = await createProject({
          item: updatedItem,
          visibility: "private",
        });
        if (saved) {
          setProject(saved);
          setCurrentImage(saved.renderedImage || result.renderedImage);
        }

        setProcessingProgress(100);
        await new Promise((resolve) => setTimeout(resolve, 260));
      }
    } catch (e) {
      console.error(`Failed to generate 3D view: ${e}`);
    } finally {
      clearProcessingInterval();
      setIsProcessing(false);
      setProcessingProgress(0);
    }
  };

  useEffect(() => {
    return () => {
      clearProcessingInterval();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadProject = async () => {
      if (!id) {
        setIsProjectLoading(false);
        return;
      }

      setIsProjectLoading(true);

      const fetchedProject = await getProjectById({ id });

      if (!isMounted) return;

      setProject(fetchedProject);
      setCurrentImage(fetchedProject?.renderedImage || null);
      setIsProjectLoading(false);
      hasInitialGenerated.current = false;
    };

    loadProject();

    return () => {
      isMounted = false;
    };
  }, [id]);

  useEffect(() => {
    if (
      isProjectLoading ||
      hasInitialGenerated.current ||
      !project?.sourceImage
    )
      return;

    if (project.renderedImage) {
      setCurrentImage(project.renderedImage);
      hasInitialGenerated.current = true;
      return;
    }

    hasInitialGenerated.current = true;
    void runGeneration(project);
  }, [project, isProjectLoading]);
  return (
    <div className={"visualizer"}>
      <nav className={"topbar"}>
        <div className={"brand"}>
          <Box className={"logo"} />
          <span className={"name"}>Roomify</span>
        </div>
        <Button
          variant={"ghost"}
          size={"sm"}
          onClick={handleBack}
          className={"exit"}
        >
          <X className={"icon"} /> Exit Editor
        </Button>
      </nav>

      <section className={"content"}>
        <div className={"panel"}>
          <div className="panel-header">
            <div className={"panel-meta"}>
              <p>Project</p>
              <h2>{project?.name || `Residence ${id}`}</h2>
              <p className={"note"}>Created by you</p>
            </div>

            <div className={"panel-actions"}>
              <Button
                size={"sm"}
                onClick={handleExport}
                className={"export"}
                disabled={!currentImage}
              >
                <Download className={"w-4 h-4 mr-2"} /> Export
              </Button>
              <Button
                size={"sm"}
                onClick={() => {}}
                className={"share"}
                disabled={!currentImage}
              >
                <Download className={"w-4 h-4 mr-2"} /> Share
              </Button>
            </div>
          </div>

          <div className={`render-area ${isProcessing ? "is-processing" : ""}`}>
            {currentImage ? (
              <img src={currentImage} alt="A render" className={"render-img"} />
            ) : (
              <div className={"render-placeholder"}>
                {project?.sourceImage && (
                  <img
                    src={project?.sourceImage}
                    alt="Original render"
                    className={"render-fallback"}
                  />
                )}
              </div>
            )}

            {isProcessing && (
              <div className={"render-overlay"}>
                <div className={"rendering-card"}>
                  <RefreshCcw className={"spinner"} />
                  <span className={"title"}> Rendering...</span>
                  <span className={"subtitle"}>
                    {getProcessingLabel(processingProgress)}
                  </span>

                  <div className={"render-progress"}>
                    <div
                      className={"render-progress-bar"}
                      style={{ width: `${processingProgress}%` }}
                    />
                  </div>

                  <span className={"progress-value"}>
                    {processingProgress}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={"panel compare"}>
          <div className={"panel-header"}>
            <div className={"panel-meta"}>
              <p>Comparison</p>
              <h3>Before and After</h3>
            </div>
            <div className={"hint"}> Drag to Compare</div>
          </div>

          <div className={"compare-stage"}>
            {project?.sourceImage && currentImage ? (
              <ReactCompareSlider
                defaultValue={50}
                style={{ width: "100%", height: "auto" }}
                itemOne={
                  <ReactCompareSliderImage
                    src={project?.sourceImage}
                    alt={"before"}
                    className={"compare-img"}
                  />
                }
                itemTwo={
                  <ReactCompareSliderImage
                    src={currentImage}
                    alt={"after"}
                    className={"compare-img"}
                  />
                }
              />
            ) : (
              <div className={"compare-fallback"}>
                {project?.sourceImage && (
                  <img
                    src={project.sourceImage}
                    alt={"Before"}
                    className={"compare-img"}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
