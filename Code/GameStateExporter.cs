using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using MegaCrit.Sts2.Core.Entities.Cards;
using MegaCrit.Sts2.Core.Entities.Players;
using MegaCrit.Sts2.Core.Models;
using MegaCrit.Sts2.Core.Runs;

namespace SpireScryer;

public static class GameStateExporter
{
    private static readonly PropertyInfo? _stateProperty =
        typeof(RunManager).GetProperty("State", BindingFlags.NonPublic | BindingFlags.Instance);

    public static StateDto Export()
    {
        var dto = new StateDto
        {
            timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            inRun = false,
        };

        try
        {
            var manager = RunManager.Instance;
            if (manager == null || !manager.IsInProgress)
                return dto;

            var state = GetRunState(manager);
            if (state == null)
                return dto;

            dto.inRun = true;
            dto.ascension = state.AscensionLevel;
            dto.act = state.CurrentActIndex;
            dto.floor = state.ActFloor;

            foreach (var player in state.Players)
            {
                dto.players.Add(ExportPlayer(player));
            }
        }
        catch (Exception ex)
        {
            ModLogger.Error($"Export failed: {ex}");
        }

        return dto;
    }

    private static RunState? GetRunState(RunManager manager)
    {
        if (_stateProperty != null)
        {
            var val = _stateProperty.GetValue(manager);
            if (val is RunState s) return s;
        }
        return manager.DebugOnlyGetState();
    }

    private static PlayerDto ExportPlayer(Player player)
    {
        var dto = new PlayerDto
        {
            netId = player.NetId,
            character = player.Character.Id.ToString(),
            currentHp = player.Creature.CurrentHp,
            maxHp = player.Creature.MaxHp,
            gold = player.Gold,
            maxEnergy = player.MaxEnergy,
            deck = player.Deck.Cards.Select(ExportCard).ToList(),
            relics = player.Relics.Select(ExportRelic).ToList(),
            potionSlots = player.PotionSlots.Select(ExportPotion).ToList(),
        };

        if (player.PlayerCombatState != null)
        {
            dto.combat = ExportCombat(player, player.PlayerCombatState);
        }

        return dto;
    }

    private static CombatDto ExportCombat(Player player, PlayerCombatState combat)
    {
        return new CombatDto
        {
            energy = combat.Energy,
            maxEnergy = SafeGetMaxEnergy(combat),
            block = player.Creature.Block,
            hand = combat.Hand.Cards.Select(ExportCard).ToList(),
            drawPile = combat.DrawPile.Cards.Select(ExportCard).ToList(),
            discardPile = combat.DiscardPile.Cards.Select(ExportCard).ToList(),
            exhaustPile = combat.ExhaustPile.Cards.Select(ExportCard).ToList(),
            powers = player.Creature.Powers.Select(p => new PowerDto
            {
                id = p.Id.ToString(),
                type = p.Type.ToString(),
                amount = p.Amount,
            }).ToList(),
        };
    }

    private static int SafeGetMaxEnergy(PlayerCombatState combat)
    {
        try { return combat.MaxEnergy; }
        catch { return 0; }
    }

    private static CardDto ExportCard(CardModel card)
    {
        return new CardDto
        {
            id = card.Id.ToString(),
            title = SafeGet(() => card.Title),
            description = SafeGetCardDescription(card),
            type = card.Type.ToString(),
            rarity = card.Rarity.ToString(),
            character = SafeGet(() => card.Pool?.Title ?? "") ?? "",
            cost = card.EnergyCost.Canonical,
            costX = card.EnergyCost.CostsX,
            upgradeLevel = card.CurrentUpgradeLevel,
            isUpgraded = card.IsUpgraded,
        };
    }

    private static string SafeGetCardDescription(CardModel card)
    {
        try
        {
            return card.GetDescriptionForPile(PileType.None) ?? "";
        }
        catch
        {
            try
            {
                return card.Description.GetFormattedText() ?? "";
            }
            catch
            {
                return "";
            }
        }
    }

    private static RelicDto ExportRelic(RelicModel relic)
    {
        return new RelicDto
        {
            id = relic.Id.ToString(),
            title = SafeGet(() => relic.Title.GetFormattedText()),
            description = SafeGet(() => relic.DynamicDescription.GetFormattedText()),
            rarity = relic.Rarity.ToString(),
            stackCount = relic.StackCount,
        };
    }

    private static PotionDto? ExportPotion(PotionModel? potion)
    {
        if (potion == null) return null;
        return new PotionDto
        {
            id = potion.Id.ToString(),
            title = SafeGet(() => potion.Title.GetFormattedText()),
            description = SafeGet(() => potion.DynamicDescription.GetFormattedText()),
            rarity = potion.Rarity.ToString(),
        };
    }

    private static string SafeGet(Func<string> getter)
    {
        try { return getter() ?? ""; }
        catch { return ""; }
    }
}
