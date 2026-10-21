import { SurgeryRecord } from "@prostapaper/contracts";

export function fixture(): SurgeryRecord {
  return SurgeryRecord.parse({
    surgery: {
      surgery_date: "2026-10-01",
      surgery_type: "2",
      lymphadenectomy: "1",
      node_no_surgery: 8,
      node_positive_no_surgery: 1,
      pt_surg: "8",
      pn_surg: "2",
      pm_surg: "5",
      classify_r_surg: "1",
      classify_l_surg: "1",
      vascular_inv: "1",
      isup: "2",
      histol_post_surg: "1",
      histol_post_surg_specify: "Acinar adenocarcinoma",
      surgery_text: "Histological finding",
    },
    lesions: [
      {
        sur_prostate_regions: ["pzpl_base_ls"],
        all_sgm: false,
        hist_type_sur: "2",
        lesion_x_mm: 12,
        lesion_y_mm: 8,
        lesion_z_mm: 6,
        extracaps_ext: "1",
        perineural_inv_sur: "1",
        gleason_prim_grade: "3",
        gleason_prim_perc: 80,
        gleason_sec_grade: "4",
        gleason_sec_perc: 20,
        gleason_tert_grade: null,
        gleason_tert_perc: null,
      },
    ],
  });
}
