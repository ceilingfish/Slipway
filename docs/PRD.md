# Specifcation Design Plugin

I like writing specifications when I am developing features. However these specifications keep on ending up in the repository. I would like to build a plugin for visual studio code that allows me to author specs and keep track of them. When I write a spec it is _always_ associated with a repository and a branch. Typically I have a branch that I will use as the "planning" branch, but ideally this plugin would allow me to get rid of that. Plans should have a logical lifecycle:

- Ideation - a list of plan ideas. Some of these might be partial ideas
- Design - once we have got a fully fledged idea, then we need to go through the process of fully considering all of the options and ramifications of a change
- Planning - Once the ramifications have been fully thought through we need to break this down into individual tasks and deliverables
- Execution - The plan has had one or more phases started

# Usage

The way in which the users interact with it is via a tab on the left hand side of VS code. Clicking on that will show a list of specifications.

Clicking on an individual plan will open the specification document in a new window, like any other document.

The editor should have markdown as the standard method of writing. But with inbuilt support for Mermaid charts. As an advanced feature, we probably need to build a chart editor. It should be possible to add sub-documents, all of which should appear as markdown. Specifically we should be able to add:

- Mermaid charts
- Open API specifications

I use worktrees a lot so this needs to be able to identify the worktree of a repository, and load the same set of specifications

# Storage

We do not want to litter repositories with these documents, so they need to be stored outside of the repository, likely in the user's home directory, but ideally in a place that can be versioned. Maybe in git or perhaps [beads](https://github.com/gastownhall/beads).

We should have a different repository for each repository.

# Non-Functional Criteria

When writing a specification there are usually non-functional requirements. Things like security, observability, disaster recovery, cost efficiency. They rarely get addressed in a specification, as we tend to focus on the _functional_ requirements. That's fine, but I want this tool to help resolve this. It should be possible to store a set of "non-functional criteria" document that are used to evaluate specifications.

We should have a set of default specifications that are used as a standard. For each repository we should be able to override a non-functional requirement, add new ones, or (possibly) remove ones.

# Phases

The tool should help ideas progress through different phases.

One of the crucial things about this editor is that it has to be something that Claude or any other AI agent. It needs to be reviewable, and critically reviewable within the context of certain requirements. I want to be able to review this until we can evaluate against a series of criteria.

## Ideation

The first phase is coming up with ideas.

An agent should then be able to tell us:

- How closely does this spec conform to the different non-functional requirements
- How complete is the concept. Compared to the codebase what aspects are missing

QUESTION: What skills from skills.sh can we use to make this simpler? Certainly feels like triage is relevant

One capability should be "extract an API" which allows us to extract an Open API spec

It would probably be useful to have some kind of representation of how closely we align with the criteria

## Design

Next phase is filling out the design. I don't know if ideation & design really are separate phases.

One thing I want to understand is comparing the plan to non-functional requirements. If it doesn't really fulfill any of them, then it's not a very mature idea.

I really like the idea of concept maturity. We should be able to evolve an idea from a concept to a fully fledged plan, and this tool should be able to help us do that.

Maturity comes in a couple of forms:

1. How closely this idea conforms to non-functional criteria
2. How well developed the concepts in the plan are
3. Does it cover all of the conceptual edge cases?

## Planning

Once we have a reasonably mature concept, then this tool should be able to break it down into several sub-plans. Each of these sub-plans should appear as sub-documents under the plan. Each sub-document should then have a means by which it can be executed. Executing it should trigger the creation of a git worktree, and an agent to be dispatched to start work in that worktree.

The sub-plan probably needs to include a recommendation of which agent will be used.
