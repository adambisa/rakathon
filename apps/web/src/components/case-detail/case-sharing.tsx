import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { Case, CaseAccessRole } from "@prostapaper/contracts";

import { toast } from "#lib/toast";
import { useTRPC } from "#trpc";
import { Button, Input, Modal, Select } from "#ui";

const roleLabels: Record<CaseAccessRole, string> = {
  owner: "Vlastník",
  reviewer: "Kontrolující",
  viewer: "Čtenář",
};

interface CaseSharingProps {
  case: Case;
}

export function CaseSharing({ case: item }: CaseSharingProps) {
  const [open, setOpen] = useState(false);

  if (item.accessRole !== "owner") return null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Sdílet
      </Button>
      {open && <SharingDialog caseId={item.id} onClose={() => setOpen(false)} />}
    </>
  );
}

interface SharingDialogProps {
  caseId: string;
  onClose: () => void;
}

function SharingDialog({ caseId, onClose }: SharingDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"reviewer" | "viewer">("viewer");
  const people = useQuery(trpc.case.sharing.queryOptions({ caseId }));
  const add = useMutation(
    trpc.case.addAccess.mutationOptions({
      onSuccess: async () => {
        setUserId("");
        await queryClient.invalidateQueries(trpc.case.sharing.queryFilter({ caseId }));
        toast.success("Přístup byl přidán.");
      },
    }),
  );
  const needle = search.trim().toLocaleLowerCase("cs-CZ");
  const members = people.data?.filter((person) => person.role !== null) ?? [];
  const available =
    people.data?.filter(
      (person) =>
        person.role === null && `${person.name} ${person.email}`.toLocaleLowerCase("cs-CZ").includes(needle),
    ) ?? [];

  return (
    <Modal open onClose={onClose} title="Sdílení případu">
      <div className="flex flex-col gap-5">
        <p className="text-sm opacity-70">Přístup zahrnuje všechny dokumenty a výsledky případu.</p>
        {people.isPending && <p role="status">Načítání uživatelů…</p>}
        {people.isError && (
          <div role="alert">
            <p>Uživatele se nepodařilo načíst.</p>
            <Button variant="outline" onClick={() => void people.refetch()}>
              Zkusit znovu
            </Button>
          </div>
        )}
        {people.data && (
          <>
            <div>
              <h3 className="mb-2 font-medium">Uživatelé s přístupem</h3>
              <ul className="divide-y divide-base-300">
                {members.map((person) => (
                  <li
                    key={person.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium break-words">{person.name}</p>
                      <p className="break-all opacity-60">{person.email}</p>
                    </div>
                    <span>{person.role && roleLabels[person.role]}</span>
                  </li>
                ))}
              </ul>
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (userId) add.mutate({ caseId, userId, role });
              }}
            >
              <Input
                label="Vyhledat uživatele"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setUserId("");
                }}
                placeholder="Jméno nebo e-mail"
              />
              <fieldset
                disabled={add.isPending}
                className="max-h-52 overflow-y-auto rounded-box border border-base-300 p-2"
              >
                <legend className="px-1 text-sm">Vyberte uživatele</legend>
                {available.length === 0 && <p className="p-2 text-sm opacity-60">Žádní další uživatelé.</p>}
                {available.map((person) => (
                  <Button
                    key={person.id}
                    type="button"
                    variant={userId === person.id ? "outline" : "ghost"}
                    aria-pressed={userId === person.id}
                    onClick={() => setUserId(person.id)}
                    className="h-auto w-full justify-start py-2 text-left"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium break-words">{person.name}</span>
                      <span className="block break-all opacity-60">{person.email}</span>
                    </span>
                  </Button>
                ))}
              </fieldset>
              <Select
                label="Role"
                value={role}
                disabled={add.isPending}
                onChange={(event) => setRole(event.target.value === "reviewer" ? "reviewer" : "viewer")}
              >
                <option value="viewer">Čtenář</option>
                <option value="reviewer">Kontrolující</option>
              </Select>
              <p className="text-sm opacity-70">
                {role === "viewer"
                  ? "Může prohlížet případ, dokumenty a výsledky."
                  : "Může prohlížet případ, odeslat jej ke zpracování a provést kontrolu včetně schválení."}
              </p>
              <Button
                type="submit"
                tone="primary"
                disabled={!userId || add.isPending}
                loading={add.isPending}
              >
                Přidat přístup
              </Button>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}
